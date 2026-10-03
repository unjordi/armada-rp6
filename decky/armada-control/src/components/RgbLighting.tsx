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
import { t } from "../i18n";
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
  // Opt-in gate for the charge indicator shown while asleep. Not part of
  // armada-rgb's own config, so it is loaded and saved separately.
  const [chargeIndicatorEnabled, setChargeIndicatorEnabled] = useState(false);
  const [chargeIndicatorUpdating, setChargeIndicatorUpdating] = useState(false);

  const load = useCallback(async () => {
    try {
      const next: RgbConfig | null = await getRgb();
      savedConfig.current = JSON.stringify(next);
      setConfig(next);
    } catch (error) {
      toaster.toast({ title: t("rgb.loadError"), body: friendlyError(error) });
    }
  }, []);

  const loadChargeIndicator = useCallback(async () => {
    try {
      const next = await getRgbChargeIndicatorEnabled();
      setChargeIndicatorEnabled(next.enabled);
    } catch (error) {
      toaster.toast({ title: t("rgb.chargeIndicatorLoadError"), body: friendlyError(error) });
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
          config.saturation ?? 100,
          config.brightness,
          config.effect ?? "static",
          config.speed ?? 100,
        );
        savedConfig.current = current;
      } catch (error) {
        toaster.toast({ title: t("rgb.changeError"), body: friendlyError(error) });
        load();
      }
    }, delay);

    return () => window.clearTimeout(timer);
  }, [config, load]);

  // Brightness sync has its own command, so it stays out of the debounced
  // setRgb() cycle above: savedConfig is updated in the same tick so that
  // effect never fires a redundant or racing setRgb() call.
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
      toaster.toast({ title: t("rgb.syncBrightnessError"), body: friendlyError(error) });
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
      toaster.toast({ title: t("rgb.chargeIndicatorChangeError"), body: friendlyError(error) });
    } finally {
      setChargeIndicatorUpdating(false);
    }
  };

  if (!config) return null;

  // Display-only: an unknown saved effect shows as "static" without
  // rewriting config.effect (see lib/rgbEffects).
  const effect: RgbEffect = displayedEffect(config.effect);
  const speed: number = config.speed ?? 100;
  const syncBrightness: boolean = !!config.sync_brightness;
  const colorDisabled: boolean = !config.enabled || !USES_BASE_COLOR.includes(effect);

  return (
    <>
      <PanelSection title={t("rgb.title")}>
        <ToggleRow
          label={t("common.enabled")}
          value={config.enabled}
          onChange={(enabled: boolean) => setConfig({ ...config, enabled })}
        />
        <SelectEdit
          label={t("rgb.effect")}
          value={effect}
          options={EFFECT_OPTIONS.map((option) => ({ data: option.data, label: t(option.labelKey) }))}
          disabled={!config.enabled}
          onChange={(next: RgbEffect) => setConfig({ ...config, effect: next })}
        />
        <SliderEdit
          label={t("common.brightness")}
          value={config.brightness}
          min={0}
          max={100}
          step={1}
          disabled={!config.enabled || syncBrightness}
          onChange={(brightness: number) => setConfig({ ...config, brightness })}
        />
        {USES_SPEED.includes(effect) && (
          <SliderEdit
            label={t("rgb.speed")}
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
          label={t("common.color")}
          value={colorHue(config.color)}
          min={0}
          max={359}
          step={1}
          disabled={colorDisabled}
          showValue={false}
          wrapperClassName="armada-slider-field armada-rgb-hue"
          onChange={(hue: number) => setConfig({ ...config, color: hueColor(hue) })}
        />
        <SliderEdit
          label={t("rgb.saturation")}
          value={config.saturation ?? 100}
          min={0}
          max={100}
          step={1}
          disabled={colorDisabled}
          showValue={false}
          wrapperClassName="armada-slider-field armada-rgb-saturation"
          onChange={(saturation: number) => setConfig({ ...config, saturation })}
        />
        <ToggleRow
          label={t("rgb.syncBrightness")}
          description={t("rgb.syncBrightnessDescription")}
          value={syncBrightness}
          disabled={!config.enabled || syncBrightnessUpdating}
          onChange={toggleSyncBrightness}
        />
      </PanelSection>
      <PanelSection title={t("rgb.chargeIndicator")}>
        <ToggleRow
          label={t("rgb.chargeIndicatorToggle")}
          description={t("rgb.chargeIndicatorDescription")}
          value={chargeIndicatorEnabled}
          disabled={chargeIndicatorUpdating}
          onChange={toggleChargeIndicator}
        />
      </PanelSection>
    </>
  );
}
