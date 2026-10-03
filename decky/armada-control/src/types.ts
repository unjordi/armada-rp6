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

// A text in env-presets.json is either one string or one string per locale, so a
// label that needs no translation does not cost four lines.
export type LocalizedText = string | Record<string, string>;

export interface EnvPresetOption {
  data: string;
  label: LocalizedText;
}

export interface EnvPreset {
  name: string;
  description: LocalizedText;
  // Closed list of values; absent means the value is free text.
  options?: EnvPresetOption[];
  // A hint only. The docs show these inside examples and never state a default.
  example?: string;
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

// Effects accepted by `armada-rgb set --effect`. screen_sync is a per-side
// ambilight driven by gamescope screenshots. Brightness sync is not an effect:
// it is the separate `sync_brightness` field (`armada-rgb sync-brightness
// on|off`) and combines with any effect here.
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
  saturation: number;
  // Omitted by armada-rgb when at their defaults (static / 100).
  effect?: RgbEffect;
  speed?: number;
  // armada-rgb's own snake_case key, passed through as-is. Omitted when off.
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
  // The profile armada-powerd is running right now (live daemon state),
  // independent of power.general.default_profile. Steam's performance panel
  // drives the same state, so Power.tsx treats it as "what's active".
  activePowerProfile: string;
  tweaks: Tweaks;
  installedGames: InstalledGame[];
  fexProfiles: Record<string, FexProfile>;
  envPresets: EnvPreset[];
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
  chargingFanPwm: number;
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
  // Gate for armada-powerd's battery-temperature fan floor. The curve itself
  // stays factory-only; this turns the behaviour on/off and applies
  // immediately (not part of the curve editor's Save flow).
  batteryFanEnabled: boolean;
}
