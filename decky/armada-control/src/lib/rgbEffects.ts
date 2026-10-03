import type { TranslationKey } from "../i18n";
import type { RgbEffect } from "../types";

// The armada-rgb effect list, in dropdown order. Kept here (pure, no React)
// so it can be unit-tested without a DOM. Every effect armada-rgb supports is
// listed, so `displayedEffect` never has to show a real saved effect as
// "Static".
//
// Brightness sync is not in this list: it is the separate toggle in
// RgbLighting and combines with any of these.
export const EFFECT_OPTIONS: { data: RgbEffect; labelKey: TranslationKey }[] = [
  { data: "static", labelKey: "rgb.effect.static" },
  { data: "breathing", labelKey: "rgb.effect.breathing" },
  { data: "color_cycle", labelKey: "rgb.effect.colorCycle" },
  { data: "rainbow", labelKey: "rgb.effect.rainbow" },
  { data: "load", labelKey: "rgb.effect.load" },
  { data: "battery", labelKey: "rgb.effect.battery" },
  { data: "screen_sync", labelKey: "rgb.effect.screenSync" },
];

// Effects that paint the configured base color (the rest derive their own
// hue -- screen_sync samples it from the screen, so it is NOT here and the
// color and saturation sliders are disabled for it).
export const USES_BASE_COLOR: readonly RgbEffect[] = ["static", "breathing"];

// Effects whose motion the speed slider controls. State-driven effects set
// their own cadence, and armada-rgb ignores --speed for screen_sync, so it is
// NOT here.
export const USES_SPEED: readonly RgbEffect[] = ["breathing", "color_cycle", "rainbow"];

// Resolve the effect the Effect dropdown should DISPLAY for a persisted
// config value. A real saved effect (screen_sync included) is shown as
// itself; only an unknown/future value falls back to "static" so the control
// always has a valid selection. Pure display resolution -- it never rewrites
// config.effect or triggers a set_rgb() call by itself.
export function displayedEffect(raw: RgbEffect | undefined): RgbEffect {
  const effect: RgbEffect = raw ?? "static";
  return EFFECT_OPTIONS.some((option) => option.data === effect) ? effect : "static";
}
