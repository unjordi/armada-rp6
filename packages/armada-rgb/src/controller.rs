use crate::rgb_saturation_helper::rgb_after_saturation;
use crate::{config, runtime, Effect, EffectState, LightingBackend, LightingConfig};
use anyhow::{bail, Result};
use std::path::{Path, PathBuf};
use std::thread::sleep;
use std::time::{Duration, Instant, SystemTime};

/// Frames per second for animated effects that do not set their own cadence.
const FPS: u32 = 30;

/// PID file the running daemon writes; lives in the service's RuntimeDirectory.
const DAEMON_PID_PATH: &str = "/run/armada-rgb/daemon.pid";

pub struct Controller {
    config_path: PathBuf,
    backend: LightingBackend,
    daemon_pid_path: PathBuf,
}

impl Controller {
    pub fn new(config_path: PathBuf, backend: LightingBackend) -> Self {
        Self {
            config_path,
            backend,
            daemon_pid_path: PathBuf::from(DAEMON_PID_PATH),
        }
    }

    /// Overrides where the daemon PID file is read and written.
    pub fn with_daemon_pid_path(mut self, path: PathBuf) -> Self {
        self.daemon_pid_path = path;
        self
    }

    /// True when the PID file names a live process: the daemon repaints from
    /// the saved config, so a one-shot paint would only flash over its frame.
    pub fn daemon_running(&self) -> bool {
        std::fs::read_to_string(&self.daemon_pid_path)
            .ok()
            .and_then(|text| text.trim().parse::<u32>().ok())
            .is_some_and(|pid| Path::new(&format!("/proc/{pid}")).exists())
    }

    pub fn from_env() -> Self {
        let (config_path, backend): (PathBuf, LightingBackend) = runtime::from_env();
        Self::new(config_path, backend)
    }

    pub fn get(&self) -> Result<LightingConfig> {
        let mut config: LightingConfig = config::load(&self.config_path)?;
        if config.correction.is_none() {
            config.correction = self.backend.default_correction();
        }
        Ok(config)
    }

    pub fn is_supported(&self) -> bool {
        self.backend.unsupported_reason().is_none()
    }

    pub fn set(&self, config: LightingConfig) -> Result<LightingConfig> {
        let mut config: LightingConfig = config.validate()?;
        if config.correction.is_none() {
            config.correction = self.backend.default_correction();
        }
        if !self.daemon_running() {
            self.backend.apply(&config)?;
        }
        config::save(&self.config_path, &config)?;
        Ok(config)
    }

    pub fn off(&self) -> Result<LightingConfig> {
        let mut config: LightingConfig = self.get()?;
        config.enabled = false;
        self.set(config)
    }

    pub fn apply(&self) -> Result<Option<String>> {
        if let Some(reason) = self.backend.unsupported_reason() {
            return Ok(Some(reason.into()));
        }

        let config: LightingConfig = self.get()?;
        self.backend.apply(&config)?;
        Ok(None)
    }

    /// Run the lighting daemon: keep the saved configuration painted, animate it
    /// when an effect is selected, and reload live whenever the config file
    /// changes (so a UI that writes `rgb.json` is reflected immediately). The
    /// loop re-asserts the hardware every frame, which also restores the LEDs
    /// after a suspend/resume that clears the controller. Never returns on a
    /// supported device.
    pub fn run(&self) -> Result<()> {
        if let Some(reason) = self.backend.unsupported_reason() {
            bail!("RGB unsupported: {reason}");
        }

        let count: usize = self.backend.target_count().max(1);
        let mut effects: EffectState = EffectState::default();
        let mut config: LightingConfig = self.get()?;
        let mut seen: Option<SystemTime> = config_mtime(&self.config_path);
        let start: Instant = Instant::now();
        if let Err(error) = std::fs::write(&self.daemon_pid_path, format!("{}\n", std::process::id())) {
            eprintln!("armada-rgb: cannot write {}: {error}", self.daemon_pid_path.display());
        }

        loop {
            let current: Option<SystemTime> = config_mtime(&self.config_path);
            if current != seen {
                seen = current;
                match self.get() {
                    Ok(reloaded) => config = reloaded,
                    Err(error) => eprintln!("armada-rgb: keeping previous config: {error:#}"),
                }
            }

            effects.set_user_sync_scale(config.sync_scale);

            // Static (and disabled) reuse the exact one-shot path so a saved
            // solid color — including any config-level correction — is
            // honored. `sync_brightness` is applied here too: it is a
            // modifier over the FINAL painted brightness, not part of any
            // one effect (see `LightingConfig::sync_brightness`).
            if config.effect.is_static() {
                let mut painted: LightingConfig = config.clone();
                painted.brightness = effects.scale_for_sync(config.brightness, config.sync_brightness);
                if let Err(error) = self.backend.apply(&painted) {
                    eprintln!("armada-rgb: apply failed: {error:#}");
                }
                sleep(Duration::from_secs_f64(config.effect.frame_interval(FPS)));
                continue;
            }

            if !config.enabled {
                if let Err(error) = self.backend.apply(&config) {
                    eprintln!("armada-rgb: blank failed: {error:#}");
                }
                sleep(Duration::from_secs(1));
                continue;
            }

            let t: f64 = start.elapsed().as_secs_f64();
            let (colors, brightness) = animated_frame(&mut effects, &config, t, count);
            // `sync_brightness` scales whatever brightness the effect just
            // computed (a plain color, a breath, rainbow, ...) — it composes
            // with any effect rather than being one itself.
            let brightness: u8 = effects.scale_for_sync(brightness, config.sync_brightness);
            if let Err(error) = self.backend.render(&colors, brightness) {
                eprintln!("armada-rgb: render failed: {error:#}");
            }
            sleep(Duration::from_secs_f64(config.effect.frame_interval(FPS)));
        }
    }
}

/// One animated frame with the saturation slider applied the way the static
/// path applies it: to the base color, and to the colors an effect synthesizes
/// from a hue. screen_sync mirrors the screen, so its sampled colors are left
/// as captured.
fn animated_frame(
    effects: &mut EffectState,
    config: &LightingConfig,
    t: f64,
    count: usize,
) -> (Vec<[u8; 3]>, u8) {
    let base: [u8; 3] = rgb_after_saturation(config.rgb(), config.saturation);
    let (frame, brightness) =
        effects.render(config.effect, base, config.brightness, config.speed, t, count);
    let mut colors: Vec<[u8; 3]> = frame.expand(count);
    if config.effect != Effect::ScreenSync {
        for color in &mut colors {
            *color = rgb_after_saturation(*color, config.saturation);
        }
    }
    (colors, brightness)
}

fn config_mtime(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|meta| meta.modified()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(effect: Effect, color: &str, saturation: u8) -> LightingConfig {
        LightingConfig {
            effect,
            color: color.into(),
            saturation,
            ..LightingConfig::default()
        }
    }

    #[test]
    fn animated_effects_honour_the_saturation_slider() {
        let mut effects: EffectState = EffectState::default();
        // Breathing paints the base color: same transform as the static path.
        let (colors, _) = animated_frame(&mut effects, &config(Effect::Breathing, "FF0000", 50), 0.0, 2);
        assert_eq!(colors, vec![[255, 128, 128]; 2]);
        // Hue effects synthesize fully saturated colors; the slider desaturates them.
        let (colors, _) = animated_frame(&mut effects, &config(Effect::ColorCycle, "FFFFFF", 0), 0.0, 2);
        assert_eq!(colors, vec![[255, 255, 255]; 2], "saturation 0 turns the cycle white");
        let (colors, _) = animated_frame(&mut effects, &config(Effect::Rainbow, "FFFFFF", 0), 0.0, 4);
        assert!(colors.iter().all(|c| c[0] == c[1] && c[1] == c[2]), "rainbow at 0 is gray: {colors:?}");
    }

    #[test]
    fn full_saturation_leaves_animated_colors_as_rendered() {
        let mut effects: EffectState = EffectState::default();
        let (colors, _) = animated_frame(&mut effects, &config(Effect::ColorCycle, "FFFFFF", 100), 0.0, 1);
        assert_eq!(colors, vec![[255, 0, 0]], "hue 0 at full saturation is red");
    }
}
