import { toaster } from "@decky/api";
import { PanelSection } from "@decky/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getRgb,
  getRgbChargeIndicatorEnabled,
  setRgb,
  setRgbChargeIndicatorEnabled,
  setRgbSyncBrightness,
} from "../backend";
import { friendlyError } from "../lib/errors";
import { displayedEffect, EFFECT_OPTIONS, USES_BASE_COLOR, USES_SPEED } from "../lib/rgbEffects";
import type { RgbConfig, RgbEffect } from "../types";
import { SelectEdit, SliderEdit, ToggleRow } from "./widgets";

const UPDATE_INTERVAL_MS: number = 100;

function colorHue(color: string): number {
  const red: number = Number.parseInt(color.slice(0, 2), 16) / 255;
  const green: number = Number.parseInt(color.slice(2, 4), 16) / 255;
  const blue: number = Number.parseInt(color.slice(4, 6), 16) / 255;
  const maximum: number = Math.max(red, green, blue);
  const difference: number = maximum - Math.min(red, green, blue);

  if (difference === 0) return 0;

  let hue: number;
  if (maximum === red) hue = (green - blue) / difference;
  else if (maximum === green) hue = 2 + (blue - red) / difference;
  else hue = 4 + (red - green) / difference;

  return Math.round((hue * 60 + 360) % 360);
}

function hexChannel(value: number): string {
  return Math.round(value).toString(16).padStart(2, "0").toUpperCase();
}

function hueColor(hue: number): string {
  const normalizedHue: number = hue % 360;
  const section: number = Math.floor(normalizedHue / 60);
  const value: number = ((normalizedHue % 60) / 60) * 255;
  const rising: string = hexChannel(value);
  const falling: string = hexChannel(255 - value);

  switch (section) {
    case 0: return `FF${rising}00`;
    case 1: return `${falling}FF00`;
    case 2: return `00FF${rising}`;
    case 3: return `00${falling}FF`;
    case 4: return `${rising}00FF`;
    default: return `FF00${falling}`;
  }
}

export function RgbLighting() {
  const [config, setConfig] = useState<RgbConfig | null>(null);
  const savedConfig = useRef<string>("");
  const lastUpdate = useRef<number>(0);
  const [syncBrightnessUpdating, setSyncBrightnessUpdating] = useState(false);

  // armada#26: opt-in gate for the suspend hook's charge-indicator pin --
  // NOT part of armada-rgb's own LightingConfig, loaded/saved separately.
  const [chargeIndicatorEnabled, setChargeIndicatorEnabled] = useState(false);
  const [chargeIndicatorUpdating, setChargeIndicatorUpdating] = useState(false);

  const load = useCallback(async () => {
    try {
      const next: RgbConfig | null = await getRgb();
      savedConfig.current = JSON.stringify(next);
      setConfig(next);
    } catch (error) {
      toaster.toast({ title: "Could not load RGB lighting", body: friendlyError(error) });
    }
  }, []);

  const loadChargeIndicator = useCallback(async () => {
    try {
      const next = await getRgbChargeIndicatorEnabled();
      setChargeIndicatorEnabled(next.enabled);
    } catch (error) {
      toaster.toast({ title: "Could not load charging indicator setting", body: friendlyError(error) });
    }
  }, []);

  useEffect(() => {
    load();
    loadChargeIndicator();
  }, [load, loadChargeIndicator]);

  useEffect(() => {
    if (!config) return;
    const current: string = JSON.stringify(config);
    if (current === savedConfig.current) return;

    const elapsed: number = Date.now() - lastUpdate.current;
    const delay: number = Math.max(0, UPDATE_INTERVAL_MS - elapsed);
    const timer: number = window.setTimeout(async () => {
      lastUpdate.current = Date.now();
      try {
        await setRgb(
          config.enabled,
          config.color,
          config.brightness,
          config.effect ?? "static",
          config.speed ?? 100,
        );
        savedConfig.current = current;
      } catch (error) {
        toaster.toast({ title: "Could not change RGB lighting", body: friendlyError(error) });
        load();
      }
    }, delay);

    return () => window.clearTimeout(timer);
  }, [config, load]);

  // armada#23: an orthogonal toggle with its OWN dedicated command -- kept
  // out of the generic debounced setRgb() cycle above (which doesn't know
  // about sync_brightness at all) by updating savedConfig.current in the
  // same tick, so that effect never fires a redundant/racing setRgb() call.
  const toggleSyncBrightness = async (enabled: boolean) => {
    if (!config) return;
    setSyncBrightnessUpdating(true);
    const optimistic: RgbConfig = { ...config, sync_brightness: enabled };
    savedConfig.current = JSON.stringify(optimistic);
    setConfig(optimistic);
    try {
      const next = await setRgbSyncBrightness(enabled);
      savedConfig.current = JSON.stringify(next);
      setConfig(next);
    } catch (error) {
      const reverted: RgbConfig = { ...config, sync_brightness: !enabled };
      savedConfig.current = JSON.stringify(reverted);
      setConfig(reverted);
      toaster.toast({ title: "Could not change brightness sync", body: friendlyError(error) });
    } finally {
      setSyncBrightnessUpdating(false);
    }
  };

  const toggleChargeIndicator = async (enabled: boolean) => {
    setChargeIndicatorUpdating(true);
    setChargeIndicatorEnabled(enabled);
    try {
      const next = await setRgbChargeIndicatorEnabled(enabled);
      setChargeIndicatorEnabled(next.enabled);
    } catch (error) {
      setChargeIndicatorEnabled(!enabled);
      toaster.toast({ title: "Could not change charging indicator setting", body: friendlyError(error) });
    } finally {
      setChargeIndicatorUpdating(false);
    }
  };

  if (!config) return null;

  // The effect the dropdown shows for the saved config. Every effect
  // armada-rgb supports is offered (screen_sync included, armada#27), so a
  // real saved effect is shown as itself -- only a genuinely unknown/future
  // value falls back to "static". Display-only; doesn't rewrite config.effect
  // or send a set_rgb() by itself (that only happens if the user then touches
  // the Effect dropdown). See lib/rgbEffects.
  const effect: RgbEffect = displayedEffect(config.effect);
  const speed: number = config.speed ?? 100;
  const syncBrightness: boolean = !!config.sync_brightness;
  const colorDisabled: boolean = !config.enabled || !USES_BASE_COLOR.includes(effect);

  return (
    <>
      <PanelSection title="RGB Lighting">
        <ToggleRow
          label="Enabled"
          value={config.enabled}
          onChange={(enabled: boolean) => setConfig({ ...config, enabled })}
        />
        <SelectEdit
          label="Effect"
          value={effect}
          options={EFFECT_OPTIONS}
          disabled={!config.enabled}
          onChange={(next: RgbEffect) => setConfig({ ...config, effect: next })}
        />
        <SliderEdit
          label="Brightness"
          value={config.brightness}
          min={0}
          max={100}
          step={1}
          disabled={!config.enabled || syncBrightness}
          onChange={(brightness: number) => setConfig({ ...config, brightness })}
        />
        {USES_SPEED.includes(effect) && (
          <SliderEdit
            label="Speed"
            value={speed}
            min={10}
            max={400}
            step={10}
            disabled={!config.enabled}
            format={(value: number) => `${value}%`}
            onChange={(next: number) => setConfig({ ...config, speed: next })}
          />
        )}
        <SliderEdit
          label="Color"
          value={colorHue(config.color)}
          min={0}
          max={359}
          step={1}
          disabled={colorDisabled}
          showValue={false}
          wrapperClassName="armada-slider-field armada-rgb-hue"
          onChange={(hue: number) => setConfig({ ...config, color: hueColor(hue) })}
        />
        {/* armada#23: orthogonal to Effect -- combines with any of them. */}
        <ToggleRow
          label="Sync w/ screen brightness"
          description="Scales the lighting's brightness to the panel backlight, on top of whatever effect/color is set above. Disables the Brightness slider while on."
          value={syncBrightness}
          disabled={!config.enabled || syncBrightnessUpdating}
          onChange={toggleSyncBrightness}
        />
      </PanelSection>
      <PanelSection title="Charging Indicator">
        <ToggleRow
          label="Show charging status while asleep"
          description="While it sleeps and charges, the stick LEDs glow amber (green once full) so you can tell it's charging at a glance."
          value={chargeIndicatorEnabled}
          disabled={chargeIndicatorUpdating}
          onChange={toggleChargeIndicator}
        />
      </PanelSection>
    </>
  );
}
