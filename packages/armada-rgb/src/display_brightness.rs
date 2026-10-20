//! Helpers for deriving RGB settings from display brightness.

use anyhow::{bail, Context, Result};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

const BACKLIGHT_ROOT: &str = "/sys/class/backlight";

/// Read the selected display backlight as a percentage of its sysfs range.
///
/// `ARMADA_PRIMARY_BACKLIGHT` selects the device on systems with multiple
/// backlights. `ARMADA_BACKLIGHT_ROOT` allows the sysfs root to be overridden
/// for development with a fixture; production defaults to `/sys/class/backlight`.
pub(crate) fn screen_brightness_percent() -> Result<u8> {
    let root: PathBuf = backlight_root();
    let primary: Option<String> = env::var("ARMADA_PRIMARY_BACKLIGHT").ok();
    screen_brightness_percent_at(&root, primary.as_deref())
}

/// The backlight root, from `ARMADA_BACKLIGHT_ROOT` or `/sys/class/backlight`.
pub(crate) fn backlight_root() -> PathBuf {
    env::var_os("ARMADA_BACKLIGHT_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(BACKLIGHT_ROOT))
}

/// `screen_brightness_percent` with the root and primary device given.
pub(crate) fn screen_brightness_percent_at(root: &Path, primary: Option<&str>) -> Result<u8> {
    let backlight: PathBuf = select_backlight(root, primary)?;
    let brightness: u32 = read_value(&backlight.join("brightness"))?;
    let maximum: u32 = read_value(&backlight.join("max_brightness"))?;

    if maximum == 0 {
        bail!("backlight maximum brightness is zero");
    }

    // Round to the nearest whole percent and clamp any out-of-range driver value.
    let percent: u64 = (u64::from(brightness) * 100 + u64::from(maximum) / 2) / u64::from(maximum);
    Ok(percent.min(100) as u8)
}

/// Scale the configured RGB brightness ceiling by screen brightness.
pub(crate) fn linked_brightness(screen_percent: u8, max_brightness: u8) -> u8 {
    let screen_percent: u16 = u16::from(screen_percent.min(100));
    let max_brightness: u16 = u16::from(max_brightness.min(100));
    let scaled: u16 = (screen_percent * max_brightness + 50) / 100;
    scaled.clamp(1, 100) as u8
}

fn select_backlight(root: &Path, primary: Option<&str>) -> Result<PathBuf> {
    if let Some(name) = primary {
        if !name.is_empty() {
            let path: PathBuf = root.join(name);
            if path.is_dir() {
                return Ok(path);
            }
            bail!(
                "configured primary backlight '{}' was not found",
                path.display()
            );
        }
    }

    let mut devices: Vec<PathBuf> = fs::read_dir(root)
        .with_context(|| format!("list backlights in {}", root.display()))?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_dir())
        .collect();
    devices.sort();
    // A generic `backlight` node (e.g. a pwm-backlight wrapper) beside the
    // panel's own node is not a second panel: prefer the named one.
    if devices.len() > 1 {
        devices.retain(|path| path.file_name().and_then(|name| name.to_str()) != Some("backlight"));
    }

    match devices.len() {
        0 => bail!("no backlight devices found in {}", root.display()),
        1 => Ok(devices.remove(0)),
        _ => bail!(
            "multiple backlight devices found in {}; set ARMADA_PRIMARY_BACKLIGHT",
            root.display()
        ),
    }
}

fn read_value(path: &Path) -> Result<u32> {
    let value: String = fs::read_to_string(path)
        .with_context(|| format!("read backlight value from {}", path.display()))?;
    value
        .trim()
        .parse::<u32>()
        .with_context(|| format!("parse backlight value from {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(name: &str, devices: &[(&str, u32, u32)]) -> PathBuf {
        let root: PathBuf =
            env::temp_dir().join(format!("armada-rgb-backlight-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        for (device, brightness, maximum) in devices {
            let dir: PathBuf = root.join(device);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("brightness"), format!("{brightness}\n")).unwrap();
            fs::write(dir.join("max_brightness"), format!("{maximum}\n")).unwrap();
        }
        root
    }

    #[test]
    fn reads_the_only_backlight() {
        let root: PathBuf = root("single", &[("panel", 50, 100)]);
        assert_eq!(screen_brightness_percent_at(&root, None).unwrap(), 50);
    }

    #[test]
    fn prefers_the_panel_over_a_generic_backlight_node() {
        // Retroid Pocket 6: ae94000.dsi.0 (panel, 2417/4095) and backlight (600/1023).
        let root: PathBuf = root("rp6", &[("ae94000.dsi.0", 2417, 4095), ("backlight", 600, 1023)]);
        assert_eq!(screen_brightness_percent_at(&root, None).unwrap(), 59);
    }

    #[test]
    fn two_panels_still_need_the_primary_backlight() {
        let root: PathBuf = root("dual", &[("ae94000.dsi.0", 10, 100), ("ae96000.dsi.0", 90, 100)]);
        let error: String = format!("{:#}", screen_brightness_percent_at(&root, None).unwrap_err());
        assert!(error.contains("ARMADA_PRIMARY_BACKLIGHT"), "{error}");
        assert_eq!(screen_brightness_percent_at(&root, Some("ae96000.dsi.0")).unwrap(), 90);
    }

    #[test]
    fn the_primary_backlight_can_pick_the_generic_node() {
        let root: PathBuf = root("explicit", &[("ae94000.dsi.0", 10, 100), ("backlight", 30, 100)]);
        assert_eq!(screen_brightness_percent_at(&root, Some("backlight")).unwrap(), 30);
    }
}
