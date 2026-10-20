use crate::LightingConfig;
use anyhow::{Context, Result};
use std::fs;
use std::path::{Path, PathBuf};

pub(crate) fn load(path: &Path) -> Result<LightingConfig> {
    let input: String = match fs::read_to_string(path) {
        Ok(input) => input,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(LightingConfig::default())
        }
        Err(error) => return Err(error).context("read RGB config"),
    };

    let mut config: LightingConfig = serde_json::from_str(&input).context("parse RGB config")?;
    if saved_before_max_brightness(&input) && config.link_brightness {
        // Older saves linked `brightness` itself to the screen; keep the same
        // painted level by making it the ceiling.
        config.max_brightness = config.brightness.max(1);
    }
    config.validate()
}

fn saved_before_max_brightness(input: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(input)
        .ok()
        .and_then(|value| value.as_object().map(|map| !map.contains_key("maxBrightness")))
        .unwrap_or(false)
}

pub(crate) fn save(path: &Path, config: &LightingConfig) -> Result<()> {
    let directory: &Path = path.parent().context("config path has no parent")?;
    let temporary: PathBuf = path.with_extension("tmp");
    let mut contents: Vec<u8> = serde_json::to_vec_pretty(config)?;
    contents.push(b'\n');

    fs::create_dir_all(directory).context("create config directory")?;
    fs::write(&temporary, contents).context("write temporary RGB config")?;
    fs::rename(temporary, path).context("replace RGB config")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_config(name: &str, contents: &str) -> PathBuf {
        let dir: PathBuf = std::env::temp_dir().join(format!("armada-rgb-config-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path: PathBuf = dir.join("rgb.json");
        fs::write(&path, contents).unwrap();
        path
    }

    // /etc/armada/rgb.json as saved on a Retroid Pocket 6 before the camelCase schema.
    const SNAKE_CASE_SAVE: &str = r#"{
  "version": 1,
  "enabled": true,
  "brightness": 57,
  "color": "FFF700",
  "saturation": 100,
  "effect": "rainbow",
  "sync_brightness": true,
  "sync_scale": 65
}"#;

    #[test]
    fn loads_a_snake_case_save_and_keeps_its_painted_level() {
        let path: PathBuf = temp_config("snake", SNAKE_CASE_SAVE);
        let config: LightingConfig = load(&path).unwrap();
        assert!(config.link_brightness);
        assert_eq!(config.max_brightness, 57, "old brightness becomes the linked ceiling");
        assert_eq!(config.brightness, 57);
        assert_eq!(config.sync_scale, Some(65));
        assert_eq!(config.effect, crate::Effect::Rainbow);

        save(&path, &config).unwrap();
        let saved: String = fs::read_to_string(&path).unwrap();
        assert!(saved.contains("\"linkBrightness\": true"), "{saved}");
        assert!(saved.contains("\"maxBrightness\": 57"), "{saved}");
        assert!(saved.contains("\"syncScale\": 65"), "{saved}");
        assert!(!saved.contains("sync_"), "{saved}");
        assert_eq!(load(&path).unwrap(), config, "the migrated save reloads unchanged");
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn an_explicit_max_brightness_is_not_overwritten() {
        let path: PathBuf = temp_config(
            "camel",
            r#"{"version":1,"enabled":true,"linkBrightness":true,"brightness":57,"maxBrightness":30,"color":"FFFFFF"}"#,
        );
        assert_eq!(load(&path).unwrap().max_brightness, 30);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn an_unlinked_old_save_keeps_the_default_ceiling() {
        let path: PathBuf = temp_config(
            "unlinked",
            r#"{"version":1,"enabled":true,"brightness":80,"color":"FFFFFF"}"#,
        );
        let config: LightingConfig = load(&path).unwrap();
        assert!(!config.link_brightness);
        assert_eq!(config.max_brightness, 50);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}
