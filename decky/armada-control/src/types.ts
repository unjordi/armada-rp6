export interface PowerProfile {
  label: string;
  cpu_governor: string;
  cpu_max: string;
  cpu_underclock: string;
  gpu_max: string;
  gpu_min: string;
  fan_curve: string;
}

export interface FanCurve {
  label: string;
  curve: string;
}

export interface PowerConfig {
  general: { default_profile: string };
  profiles: Record<string, PowerProfile>;
  fan_curves: Record<string, FanCurve>;
  fan: Record<string, string>;
  underclocks: Record<string, Record<string, Record<string, string>>>;
}

export interface GameTweak {
  enabled?: boolean;
  name?: string;
  fexProfile?: string;
  fexConfig?: Record<string, string>;
  thunks?: Record<string, boolean>;
  [key: string]: any;
}

export interface Tweaks {
  global: Record<string, any>;
  games: Record<string, GameTweak>;
}

export interface CompatAppliedState {
  appids: string[];
  protonDefault: string;
}

export interface InstalledGame {
  appid: string;
  name: string;
  nonSteam?: boolean;
}

export interface FexProfile {
  label: string;
  config?: Record<string, string>;
}

export interface AbsControl {
  value: number;
  min: number;
  max: number;
  flat: number;
  fuzz: number;
  resolution: number;
}

export interface CalibrationState {
  supported: boolean;
  reason: string;
  controls: Record<string, AbsControl>;
  event: any;
  canApply?: boolean;
  backend?: string;
  saved?: boolean;
  params?: Record<string, number>;
}

// Matches the armada-rgb CLI contract
// (.claude/projects/rp6-rgb-cli-contract-2026-09-18.md, corrected 2026-09-18
// late): screen_sync (armada#27) is an effect (per-side ambilight off
// gamescope screenshots). armada#23 (brightness-sync) is NOT an effect --
// it's the orthogonal `syncBrightness` field below (dedicated
// `sync-brightness on|off` command), combinable with any effect here.
export type RgbEffect =
  | "static"
  | "breathing"
  | "color_cycle"
  | "rainbow"
  | "load"
  | "battery"
  | "screen_sync";

export interface RgbConfig {
  version: number;
  enabled: boolean;
  brightness: number;
  color: string;
  // Omitted by armada-rgb when at their defaults (static / 100).
  effect?: RgbEffect;
  speed?: number;
  // armada#23: raw pass-through of armada-rgb's own JSON key (snake_case,
  // matching every other RgbConfig field -- this object is never
  // camelCased, it's armada-rgb's LightingConfig verbatim). Omitted when
  // false/default.
  sync_brightness?: boolean;
}

export interface GameRef {
  appid: string;
  name: string;
  nonSteam?: boolean;
}

export interface PerfInfo {
  governors: string[];
  schedulers: string[];
  corePresets: DropdownChoice[];
  cpuCount: number;
}

export interface Config {
  power: PowerConfig;
  powerDefaults: PowerConfig;
  // armada#24: the profile armada-powerd is running RIGHT NOW (live daemon
  // state), independent of power.general.default_profile. This is what
  // Steam's native "Rendimiento" panel also drives, so Power.tsx uses it as
  // the single source of truth for "what's active" instead of drifting.
  activePowerProfile: string;
  tweaks: Tweaks;
  installedGames: InstalledGame[];
  fexProfiles: Record<string, FexProfile>;
  perf?: PerfInfo;
  cpuDeviceClass: string;
  // Top-bar profile glyph geometry from the device conf; empty when unset.
  topBarIndicator?: { sizePx: string; marginPx: string };
  rgbSupported: boolean;
  protonDefaults: string[];
  osVersion: string;
  ablVersion: string;
  ablAutoEnabled: boolean;
  bottomScreenSupported: boolean;
  bottomScreenEnabled: boolean;
  bottomScreenBrightnessSupported: boolean;
  bottomScreenActive: boolean;
  bottomScreenBrightness: number;
  sshEnabled: boolean;
  mtpEnabled: boolean;
  desktopMode: string;
  desktopModes: DropdownChoice[];
  sleepMode: string;
  sleepModes: DropdownChoice[];
  controllerType: string;
  controllerTypes: DropdownChoice[];
  calibration?: CalibrationState;
  game?: GameRef | null;
  selectedGame?: GameRef | null;
}

export type Capture = Record<string, { center: number; min: number; max: number; range: number }>;

export interface DropdownChoice {
  data: string;
  label: string;
  // Present but not selectable (e.g. deep sleep on a model not yet validated for
  // it): the option is shown greyed with a "(not validated)" cue instead of hidden.
  disabled?: boolean;
}

export interface ProfileSummary {
  label: string;
  fan_curve: string;
}

export interface FanSettings {
  ramp_up: number;
  ramp_down: number;
  smoothing: number;
  min_pwm: number;
}

export interface CurvesState {
  fanCurves: Record<string, FanCurve>;
  factoryFanCurves: Record<string, FanCurve>;
  fanSettings: FanSettings;
  factoryFanSettings: FanSettings;
  profiles: Record<string, ProfileSummary>;
  // Falls back to the configured default, then any profile, if the daemon state can't be read.
  activeProfile: string;
  // Live marker instead polls get_current_temp (see hooks/useCurrentTemp).
  currentTemp: number | null;
  // armada#29: opt-in gate for armada-powerd's battery-temperature fan
  // floor (armada#6). The curve/boost stay factory-only -- this only turns
  // the whole behaviour on/off, applies immediately (not part of the
  // curve editor's dirty/Save flow).
  batteryFanEnabled: boolean;
}
