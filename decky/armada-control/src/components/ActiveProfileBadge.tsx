import { useActivePowerProfile } from "../hooks/useActivePowerProfile";
import { t, tLabel } from "../i18n";
import { titleCase } from "../lib/util";

const PROFILE_ICON: Record<string, string> = {
  eco: "🌿",
  performance: "⚡",
  // balanced: no icon -- matches the "Rendimiento" panel's own convention of
  // only marking the two non-default extremes (see the 2026-09-18 QA note
  // this responds to).
};

// armada#25 (partial): a live "which power profile is active" indicator.
// This is the SAFE, officially-typed half of the ask -- Decky's `titleView`
// (see @decky/api's Plugin interface) renders it as Armada Control's own
// header whenever its Quick Access panel is open. It reads the same
// activePowerProfile source of truth Power.tsx uses (armada#24), so it can
// never show something Power.tsx or Steam's "Rendimiento" panel disagree
// with.
//
// What this is NOT: an icon in the SYSTEM top bar next to battery/clock,
// visible without opening this panel. That needs patching Steam's own
// gamepadui React tree (@decky/ui exports findModuleChild/afterPatch for
// exactly that, and other Decky plugins do it) -- but the target component
// is a property of the CURRENT steamui bundle that could not be verified
// offline in this session (no live device/browser devtools connection). See
// topBarProfileIndicator.ts for a ready-to-fill skeleton and
// .claude/projects/rp6-control-ui-RESULTADO-2026-09-18.md for how to find
// the real target before wiring it in.
export function ActiveProfileBadge() {
  const active = useActivePowerProfile();
  if (!active) return null;
  const icon = PROFILE_ICON[active];
  return (
    <span title={t("Power profile: {profile}", { profile: tLabel(titleCase(active)) })}>
      Armada Control{icon ? ` ${icon}` : ""}
    </span>
  );
}
