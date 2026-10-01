import { toaster } from "@decky/api";
import { ButtonItem, Field, PanelSection, PanelSectionRow, showModal } from "@decky/ui";
import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { getFansState, saveFanCurves, setBatteryFanEnabled } from "../backend";
import { CreateCurveModal } from "../components/CreateCurveModal";
import { FanCurveEditor } from "../components/FanCurveEditor";
import { FanCurveEditorModal } from "../components/FanCurveEditorModal";
import { ToggleRow } from "../components/widgets";
import { useCurrentTemp } from "../hooks/useCurrentTemp";
import { useFanCurvesSave } from "../hooks/useFanCurvesSave";
import { friendlyError } from "../lib/errors";
import { clone } from "../lib/util";
import type { Config, CurvesState } from "../types";
import { t } from "../i18n";

export function Fans({ setConfig }: {
  setConfig: Dispatch<SetStateAction<Config | null>>;
}) {
  const [saved, setSaved] = useState<CurvesState | null>(null);
  const [draft, setDraft] = useState<CurvesState | null>(null);
  const [message, setMessage] = useState(t("Loading"));
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
      setMessage(friendlyError(error, t("Could not load fan curves")));
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

  // armada#29: applies immediately (like the Settings tab's toggles), not
  // part of the curve editor's dirty/Save flow -- it's a separate on/off
  // gate for armada-powerd's own baked-in battery floor, not a curve edit.
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
      toaster.toast({ title: t("Could not change battery fan floor"), body: friendlyError(error) });
    } finally {
      setBatteryFanUpdating(false);
    }
  };

  if (!draft) {
    return (
      <PanelSection title={t("Armada Fans")}>
        <Field label={message} />
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
      <PanelSection title={t("BATTERY FAN FLOOR")}>
        <ToggleRow
          label={t("Floor the fan by battery temperature")}
          description={t("Keeps the fan running (with a boost while charging) even if CPU/GPU are cool, so a hot battery under fast charging still gets airflow. Off restores the stock behaviour.")}
          value={draft.batteryFanEnabled}
          disabled={batteryFanUpdating}
          onChange={toggleBatteryFan}
        />
      </PanelSection>
      <PanelSection title={t("SAVE")}>
        <PanelSectionRow>
          <div className="afc-control-inset">
            <ButtonItem layout="below" onClick={handleSave} disabled={!dirty || saving}>
              {saving ? t("Saving...") : t("Save Changes")}
            </ButtonItem>
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <div className="afc-control-inset">
            <ButtonItem layout="below" onClick={handleRevert} disabled={!dirty || saving}>{t("Revert Changes")}</ButtonItem>
          </div>
        </PanelSectionRow>
        {dirty ? <div className="afc-note">{t("You have unsaved changes.")}</div> : null}
      </PanelSection>
    </div>
  );
}
