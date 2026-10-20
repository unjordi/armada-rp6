//! Command line interface for RGB lighting.

use anyhow::Result;
use armada_rgb::{
    watch_brightness, ColorCorrection, Controller, Effect, EffectState, LightingConfig,
    ScreenSyncProbe,
};
use clap::{Parser, Subcommand};
use std::time::Duration;

#[derive(Parser)]
#[command(version, about)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Check whether this device has a lighting profile.
    Supported,
    /// Show the saved lighting configuration.
    Get,
    /// Set a solid color and brightness.
    Set {
        /// Whether the RGB lighting is enabled.
        #[arg(long, action = clap::ArgAction::Set)]
        enabled: Option<bool>,
        /// Link RGB brightness to screen brightness.
        #[arg(long, action = clap::ArgAction::Set)]
        link_brightness: Option<bool>,
        /// Maximum RGB brightness while screen linking is enabled.
        #[arg(long)]
        max_brightness: Option<u8>,
        #[arg(long)]
        color: String,
        #[arg(long)]
        saturation: Option<u8>,
        #[arg(long)]
        brightness: u8,
        /// RGB correction trigger and channel reductions.
        #[arg(long, value_name = "TRIGGER:RED,GREEN,BLUE")]
        correction: Option<ColorCorrection>,
        /// Animation: static, breathing, color_cycle, rainbow, load, battery,
        /// screen_sync. (Brightness-follows-backlight is NOT an effect — it is
        /// the orthogonal `sync-brightness on/off` toggle, combinable with any
        /// of these.)
        #[arg(long, value_parser = parse_effect)]
        effect: Option<Effect>,
        /// Animation speed as a percentage (100 = default).
        #[arg(long)]
        speed: Option<u16>,
        /// LED-vs-screen factor for brightness sync, in percent (10-200), or
        /// `default` to go back to the device value.
        #[arg(long, value_name = "PERCENT|default")]
        sync_scale: Option<String>,
    },
    /// Turn the stick lights off and save that state.
    Off,
    /// Apply the saved configuration.
    Apply,
    /// Watch display brightness and reapply linked RGB brightness when it changes.
    Watch {
        /// Polling interval in milliseconds.
        #[arg(long, default_value_t = 200)]
        interval_ms: u64,
    },
    /// Turn MCU-driven lights off without saving.
    Sleep,
    /// Restore saved lighting after sleep on MCU-driven backends.
    Wake,
    /// Run the lighting daemon: keep the saved configuration painted, animate
    /// the selected effect, and reload live when the config changes.
    Run,
    /// Toggle brightness-follows-screen-backlight as a MODIFIER on top of
    /// whatever color/effect is already configured — not a replacement
    /// effect. Persists (`linkBrightness` in the saved configuration) and
    /// takes effect on `run`'s next tick (at most ~1s later) without
    /// touching color/effect/brightness.
    SyncBrightness {
        #[command(subcommand)]
        state: SyncBrightnessState,
    },
    /// Diagnostic/benchmark: run one or more instrumented `screen_sync`
    /// captures and print the compositor-capture time, the read+sample time
    /// (no PNG decode), the raw NV12 size, the resolved geometry, and the
    /// sampled left/right edge colors. Uses the same env overrides as `run`.
    #[command(hide = true)]
    ScreenSyncProbe {
        /// How many captures to take.
        #[arg(long, default_value_t = 5)]
        iterations: u32,
    },
}

#[derive(Subcommand)]
enum SyncBrightnessState {
    /// Scale the painted brightness by the live screen backlight percentage,
    /// with the current brightness as the ceiling.
    On,
    /// Use the configured brightness as-is (the default).
    Off,
}

fn parse_effect(value: &str) -> Result<Effect, String> {
    value.parse()
}

fn main() -> Result<()> {
    let cli: Cli = Cli::parse();
    let controller: Controller = Controller::from_env();

    match cli.command {
        Command::Supported => {
            if !controller.is_supported() {
                std::process::exit(1);
            }
        }
        Command::Get => {
            let config: LightingConfig = controller.get()?;
            println!("{}", serde_json::to_string_pretty(&config)?);
        }
        Command::Set {
            enabled,
            link_brightness,
            max_brightness,
            color,
            saturation,
            brightness,
            correction,
            effect,
            speed,
            sync_scale,
        } => {
            let mut config: LightingConfig = controller.get()?;
            config.enabled = enabled.unwrap_or(true);
            if let Some(link_brightness) = link_brightness {
                config.link_brightness = link_brightness;
            }
            if let Some(max_brightness) = max_brightness {
                config.max_brightness = max_brightness;
            }
            config.color = color;

            if let Some(saturation) = saturation {
                config.saturation = saturation;
            }

            config.brightness = brightness;

            if let Some(correction) = correction {
                config.correction = Some(correction);
            }
            if let Some(effect) = effect {
                config.effect = effect;
            }
            if let Some(speed) = speed {
                config.speed = speed;
            }
            if let Some(raw) = sync_scale {
                config.sync_scale = if raw == "default" {
                    None
                } else {
                    Some(raw.parse::<u16>().map_err(|_| anyhow::anyhow!("--sync-scale: expected a percentage or 'default'"))?)
                };
            }
            let config: LightingConfig = controller.set(config)?;
            println!("{}", serde_json::to_string_pretty(&config)?);
        }
        Command::Off => {
            let config: LightingConfig = controller.off()?;
            println!("{}", serde_json::to_string_pretty(&config)?);
        }
        Command::Apply => {
            if let Some(reason) = controller.apply()? {
                eprintln!("RGB unsupported: {reason}");
            }
        }
        Command::Run => {
            controller.run()?;
        }
        Command::SyncBrightness { state } => {
            let mut config: LightingConfig = controller.get()?;
            config.link_brightness = matches!(state, SyncBrightnessState::On);
            if config.link_brightness {
                // Keep the painted level: the current brightness becomes the ceiling.
                config.max_brightness = config.brightness.max(1);
            }
            let config: LightingConfig = controller.set(config)?;
            println!("{}", serde_json::to_string_pretty(&config)?);
        }
        Command::ScreenSyncProbe { iterations } => {
            let state: EffectState = EffectState::default();
            for i in 0..iterations {
                match state.probe_screen_sync() {
                    Ok(ScreenSyncProbe {
                        capture_ms,
                        process_ms,
                        bytes,
                        width,
                        height,
                        uv_offset,
                        left,
                        right,
                    }) => {
                        println!(
                            "probe {i}: capture={capture_ms:.1}ms process={process_ms:.2}ms \
                             bytes={bytes} geom={width}x{height} uv_offset={uv_offset} \
                             left={left:?} right={right:?}"
                        );
                    }
                    Err(reason) => println!("probe {i}: FAILED: {reason}"),
                }
            }
        }
        Command::Watch { interval_ms } => {
            if interval_ms == 0 {
                anyhow::bail!("watch polling interval must be greater than zero");
            }
            if controller.is_supported() {
                watch_brightness(&controller, Duration::from_millis(interval_ms))?;
            }
        }
        Command::Sleep => controller.sleep()?,
        Command::Wake => controller.wake()?,
    }
    Ok(())
}
