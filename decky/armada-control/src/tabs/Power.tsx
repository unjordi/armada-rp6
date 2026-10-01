import { toaster } from "@decky/api";
import { ButtonItem, Field, PanelSection } from "@decky/ui";
import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { SelectEdit, SliderEdit } from "../components/widgets";
import { setActivePowerProfile } from "../backend";
import { useActivePowerProfile } from "../hooks/useActivePowerProfile";
import { friendlyError } from "../lib/errors";
import { clone, titleCase, update } from "../lib/util";
import { t, tLabel } from "../i18n";
import type { Config, PowerProfile } from "../types";

const underclocks = () => [
  { data: "none", label: t("None") },
  { data: "small", label: t("Small") },
  { data: "medium", label: t("Medium") },
  { data: "large", label: t("Large") },
];

export function Power({ config, setConfig }: { config: Config; setConfig: Dispatch<SetStateAction<Config | null>> }) {
  // armada#24: start on whatever profile is ACTUALLY running, not a
  // hardcoded "balanced" -- that's what made "Balanced (editing)" vs
  // "Eco (Steam's Rendimiento panel)" look like two disagreeing systems.
  const [profile, setProfile] = useState(
    config.activePowerProfile || config.power.general.default_profile || "balanced",
  );
  const [activating, setActivating] = useState(false);
  // Live: reflects changes made from Steam's native "Rendimiento" panel too,
  // while this tab stays open.
  const activeProfile = useActivePowerProfile(config.activePowerProfile);
  const p = config.power.profiles[profile] || ({} as PowerProfile);
  const profiles = Object.entries(config.power.profiles || {}).map(([name, profile]) => ({
    data: name,
    label: tLabel(profile.label || titleCase(name)) + (name === activeProfile ? ` • ${t("Active")}` : ""),
  }));
  const fanCurves = Object.entries(config.power.fan_curves || {}).map(([name, curve]) => ({
    data: name,
    label: tLabel(curve.label || titleCase(name)),
  }));
  const setProfileValue = (name: string, value: any) => {
    setConfig((current) => (current ? update(current, ["power", "profiles", profile, name], value) : current));
  };
  const setGpuValue = (name: string, value: any) => {
    setConfig((current) => {
      if (!current) return current;
      const next = clone(current);
      const target: any = next.power.profiles[profile];
      target[name] = value;
      if (name === "gpu_min" && Number(value) > Number(target.gpu_max || 0)) {
        target.gpu_max = value;
      }
      if (name === "gpu_max" && Number(value) < Number(target.gpu_min || 0)) {
        target.gpu_min = value;
      }
      return next;
    });
  };
  const resetProfile = () => {
    const defaults = config.powerDefaults?.profiles?.[profile];
    if (!defaults) return;
    setConfig((current) => (current ? update(current, ["power", "profiles", profile], defaults) : current));
  };
  const activateProfile = async () => {
    setActivating(true);
    try {
      const next = await setActivePowerProfile(profile);
      setConfig((current) => (current ? { ...current, activePowerProfile: next.activePowerProfile } : current));
    } catch (error) {
      toaster.toast({ title: t("Could not switch power profile"), body: friendlyError(error) });
    } finally {
      setActivating(false);
    }
  };
  const activeLabel = tLabel(config.power.profiles[activeProfile]?.label || titleCase(activeProfile || ""));
  const editingLabel = tLabel(p.label || titleCase(profile));
  const underclockLevel = p.cpu_underclock || "";
  const supportsUnderclockPresets = !!config.power.underclocks?.[config.cpuDeviceClass];
  return (
    <>
      <PanelSection title={t("ACTIVE PROFILE")}>
        <Field label={t("Running now")} bottomSeparator="none">
          {activeLabel}
        </Field>
        {profile !== activeProfile ? (
          <div className="armada-reset-row">
            <ButtonItem layout="below" onClick={activateProfile} disabled={activating}>
              {activating ? t("Activating...") : t("Make \"{profile}\" active", { profile: editingLabel })}
            </ButtonItem>
          </div>
        ) : (
          <div className="armada-field-note">{t("You're editing the profile that's active right now -- changes below apply live once saved.")}</div>
        )}
      </PanelSection>
      <PanelSection title={t("EDIT POWER PROFILE")}>
        <SelectEdit value={profile} options={profiles} onChange={setProfile} />
      </PanelSection>
      <PanelSection title={t("PROFILE SETTINGS")}>
        <SelectEdit label={t("Fan Curve")} value={p.fan_curve} options={fanCurves} onChange={(v) => setProfileValue("fan_curve", v)} />
        {(config.perf?.governors?.length ?? 0) > 0 ? (
          <SelectEdit
            label={t("CPU Governor")}
            value={p.cpu_governor}
            options={config.perf!.governors.map((g) => ({ data: g, label: titleCase(g) }))}
            onChange={(v) => setProfileValue("cpu_governor", v)}
          />
        ) : null}
        {supportsUnderclockPresets ? (
          <SelectEdit label={t("CPU Underclock")} value={underclockLevel} options={underclocks()} onChange={(v) => setProfileValue("cpu_underclock", v)} />
        ) : (
          <SliderEdit label={t("CPU Max (%)")} value={Math.round(Number(p.cpu_max || 0) * 100)} min={35} max={100} step={1} onChange={(v) => setProfileValue("cpu_max", (v / 100).toFixed(2))} />
        )}
        <SliderEdit label={t("GPU Min (%)")} value={Math.round(Number(p.gpu_min || 0) * 100)} min={0} max={100} step={1} onChange={(v) => setGpuValue("gpu_min", (v / 100).toFixed(2))} />
        <SliderEdit label={t("GPU Max (%)")} value={Math.round(Number(p.gpu_max || 0) * 100)} min={35} max={100} step={1} onChange={(v) => setGpuValue("gpu_max", (v / 100).toFixed(2))} />
        <div className="armada-reset-row">
          <ButtonItem layout="below" onClick={resetProfile}>{t("Reset to Default")}</ButtonItem>
        </div>
      </PanelSection>
    </>
  );
}
