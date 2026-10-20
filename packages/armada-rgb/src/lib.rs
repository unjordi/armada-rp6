//! RGB lighting support for Armada devices.

mod backend;
mod config;
mod controller;
mod correction;
mod display_brightness;
mod effects;
mod rgb_saturation;
mod runtime;
mod state;
mod watcher;

pub use backend::{
    ChannelBackend, LightingBackend, MulticolorBackend, SerialBackend, SerialProtocol,
};
pub use controller::Controller;
pub use correction::ColorCorrection;
pub use effects::{Effect, EffectState, Frame, ScreenSyncProbe};
pub use state::LightingConfig;
pub use watcher::watch_brightness;
