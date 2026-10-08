import { toaster } from "@decky/api";
import { ButtonItem, Field, PanelSection, PanelSectionRow, showModal } from "@decky/ui";
import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { getFansState, saveFanCurves, setBatteryFanEnabled, setBatteryFanProfile } from "../backend";
import { CreateCurveModal } from "../components/CreateCurveModal";
import { FanCurveEditor } from "../components/FanCurveEditor";
import { FanCurveEditorModal } from "../components/FanCurveEditorModal";
import { SelectEdit, ToggleRow } from "../components/widgets";
import { useCurrentTemp } from "../hooks/useCurrentTemp";
import { useFanCurvesSave } from "../hooks/useFanCurvesSave";
import { t, translateLabel } from "../i18n";
import { friendlyError } from "../lib/errors";
import { clone } from "../lib/util";
import type { Config, CurvesState } from "../types";

export function Fans({ setConfig }: {
  setConfig: Dispatch<SetStateAction<Config | null>>;
}) {
  const [saved, setSaved] = useState<CurvesState | null>(null);
  const [draft, setDraft] = useState<CurvesState | null>(null);
  const [message, setMessage] = useState("Loading");
  const [selectedCurve, setSelectedCurve] = useState("");
  const currentTemp = useCurrentTemp();

  const load = useCallback(async () => {
    try {
      const next = await getFansState();
      setSaved(next);
      setDraft(clone(next));
      const names = Object.keys(next.fanCurves || {}).sort();
      const activeCurve = next.profiles?.[next.activeProfile]?.fan_curve;
      setSelectedCurve(activeCurve && names.includes(activeCurve) ? activeCurve : names[0] || "");
    } catch (error) {
      setMessage(friendlyError(error, t("fans.loadError")));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const syncSharedFanCurves = (next: CurvesState) => {
    setConfig((current) =>
      current ? { ...current, power: { ...current.power, fan_curves: next.fanCurves } } : current,
    );
  };

  const { dirty, saving, saveError, handleSave, handleRevert } = useFanCurvesSave({
    working: draft,
    saved,
    setSaved,
    setWorking: setDraft,
    save: saveFanCurves,
    onSaved: syncSharedFanCurves,
  });

  // Applies immediately, like the Settings tab's toggles: it gates
  // armada-powerd's battery-temperature floor, it is not a curve edit.
  const [batteryFanUpdating, setBatteryFanUpdating] = useState(false);
  const toggleBatteryFan = async (enabled: boolean) => {
    setDraft((current) => (current ? { ...current, batteryFanEnabled: enabled } : current));
    setBatteryFanUpdating(true);
    try {
      const next = await setBatteryFanEnabled(enabled);
      setSaved(next);
      setDraft((current) => (current ? { ...current, batteryFanEnabled: next.batteryFanEnabled } : current));
    } catch (error) {
      setDraft((current) => (current ? { ...current, batteryFanEnabled: !enabled } : current));
      toaster.toast({ title: t("fans.batteryFloorError"), body: friendlyError(error) });
    } finally {
      setBatteryFanUpdating(false);
    }
  };

  const changeBatteryProfile = async (profile: string) => {
    const previous = draft?.batteryFanProfile ?? "";
    setDraft((current) => (current ? { ...current, batteryFanProfile: profile } : current));
    setBatteryFanUpdating(true);
    try {
      const next = await setBatteryFanProfile(profile);
      setSaved(next);
      setDraft((current) => (current ? { ...current, batteryFanProfile: next.batteryFanProfile } : current));
    } catch (error) {
      setDraft((current) => (current ? { ...current, batteryFanProfile: previous } : current));
      toaster.toast({ title: t("fans.batteryProfileError"), body: friendlyError(error) });
    } finally {
      setBatteryFanUpdating(false);
    }
  };

  if (!draft) {
    return (
      <PanelSection title={t("fans.title")}>
        <Field label={message === "Loading" ? t("common.loading") : message} />
      </PanelSection>
    );
  }

  const openFullscreen = () =>
    showModal(
      <FanCurveEditorModal
        initial={draft}
        setDraft={setDraft}
        initialSelected={selectedCurve}
        onSelectedChange={setSelectedCurve}
        saved={saved}
        onSaved={(next) => {
          setSaved(next);
          syncSharedFanCurves(next);
        }}
      />,
    );
  const openCreateCurve = () =>
    showModal(
      <CreateCurveModal
        initial={draft}
        setDraft={setDraft}
        initialBaseCurve={selectedCurve}
        onCreated={setSelectedCurve}
      />,
    );

  return (
    <div className="afc-scope">
      {saveError ? <div className="afc-error">{saveError}</div> : null}
      <FanCurveEditor
        state={draft}
        setState={setDraft}
        selected={selectedCurve}
        onSelectedChange={setSelectedCurve}
        onOpenFullscreen={openFullscreen}
        onOpenCreateCurve={openCreateCurve}
        currentTemp={currentTemp}
      />
      <PanelSection title={t("fans.batteryFloor")}>
        <ToggleRow
          label={t("fans.batteryFloorToggle")}
          description={t("fans.batteryFloorDescription")}
          value={draft.batteryFanEnabled}
          disabled={batteryFanUpdating}
          onChange={toggleBatteryFan}
        />
        <SelectEdit
          label={t("fans.batteryProfile")}
          value={draft.batteryFanProfile}
          options={Object.entries(draft.batteryFanProfiles).map(([name, profile]) => ({
            data: name,
            label: translateLabel(profile.label),
          }))}
          onChange={changeBatteryProfile}
          disabled={!draft.batteryFanEnabled || batteryFanUpdating}
          wrapperClassName="afc-control-inset"
        />
      </PanelSection>
      <PanelSection title={t("fans.saveSection")}>
        <PanelSectionRow>
          <div className="afc-control-inset">
            <ButtonItem layout="below" onClick={handleSave} disabled={!dirty || saving}>
              {saving ? t("common.saving") : t("common.saveChanges")}
            </ButtonItem>
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <div className="afc-control-inset">
            <ButtonItem layout="below" onClick={handleRevert} disabled={!dirty || saving}>
              {t("common.revertChanges")}
            </ButtonItem>
          </div>
        </PanelSectionRow>
        {dirty ? <div className="afc-note">{t("common.unsavedChanges")}</div> : null}
      </PanelSection>
    </div>
  );
}
