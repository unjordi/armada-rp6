import { useActivePowerProfile } from "../hooks/useActivePowerProfile";
import { t, translateLabel } from "../i18n";
import { titleCase } from "../lib/util";

const PROFILE_ICON: Record<string, string> = {
  eco: "🌿",
  performance: "⚡",
  // balanced: no icon -- only the two non-default extremes are marked,
  // like Steam's own performance panel.
};

// A live "which power profile is active" marker in Armada Control's own
// header (Decky's `titleView`), shown whenever its Quick Access panel is
// open. It reads the same live active profile Power.tsx uses, so the two can
// never disagree. The glyph in the system top bar is lib/topBarProfileIndicator.
export function ActiveProfileBadge() {
  const active = useActivePowerProfile();
  if (!active) return null;
  const icon = PROFILE_ICON[active];
  return (
    <span title={t("power.profileBadge", { profile: translateLabel(titleCase(active)) })}>
      Armada Control{icon ? ` ${icon}` : ""}
    </span>
  );
}
