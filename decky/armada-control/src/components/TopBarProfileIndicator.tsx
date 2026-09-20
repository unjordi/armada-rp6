import { findModuleChild } from "@decky/ui";
import { useActivePowerProfile } from "../hooks/useActivePowerProfile";

// armada#25 (Camino 1 — overlay shippable OFFLINE): a live power-profile
// glyph in the SYSTEM top bar, to the LEFT of the battery percentage, in the
// same row as the clock/battery (see rp6-20260918-163358.png: 🔍 🔔 📶 "88%"
// [batería] "5:33 PM" avatar). This is NOT the panel's titleView badge
// (ActiveProfileBadge.tsx) — it lives in the gamepadui top bar without
// opening Armada Control's panel.
//
// Mechanism: routerHook.addGlobalComponent (wired in index.tsx) mounts this
// as a full-screen overlay layer; we position a single fixed element into the
// top-right cluster. useUIComposition(Notification) is the EXACT pattern from
// decky-brightness-bar (rasitayaz) so gamescope composes the overlay on top of
// the gamepadui (home / library / QAM) — the same surfaces where the top bar
// exists. We do NOT patch Steam's own React tree (Camino 2): that needs a live
// dump of the status-area node, which is build-hashed and not discoverable
// offline (see lib/topBarProfileIndicator.ts).
//
// Rule (armada#25): eco → leaf, performance → bolt, balanced → NOTHING (no
// layout gap). Unknown/unreadable profile → nothing (silent fail, no raw
// exception to the console).

enum UIComposition {
  Hidden = 0,
  Notification = 1,
  Overlay = 2,
  Opaque = 3,
  OverlayKeyboard = 4,
}

type UseUIComposition = (composition: UIComposition) => {
  releaseComposition: () => void;
};

// Same module filter as decky-brightness-bar: the gamescope composition-state
// hook, located by the stable request names it references (not a minified
// export name, which is not stable across steamui builds).
const useUIComposition: UseUIComposition = findModuleChild((m) => {
  if (typeof m !== "object") return undefined;
  for (const prop in m) {
    if (
      typeof m[prop] === "function" &&
      m[prop].toString().includes("AddMinimumCompositionStateRequest") &&
      m[prop].toString().includes("ChangeMinimumCompositionStateRequest") &&
      m[prop].toString().includes("RemoveMinimumCompositionStateRequest") &&
      !m[prop].toString().includes("m_mapCompositionStateRequests")
    ) {
      return m[prop];
    }
  }
  return undefined;
});

// Monochrome glyphs (currentColor) so the icon matches the top bar's
// battery/clock color and weight instead of relying on the system emoji font.
function LeafGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6" />
    </svg>
  );
}

function BoltGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
    </svg>
  );
}

function profileGlyph(profile: string) {
  if (profile === "eco") return <LeafGlyph />;
  if (profile === "performance") return <BoltGlyph />;
  return null; // balanced / unknown → render nothing (no layout gap)
}

// QA-VISUAL offsets — tuned against rp6-20260918-163358.png, NOT a blocker.
// The glyph sits to the LEFT of the "88%" battery text, in the same row as
// the clock. `right` is the distance from the viewport's right edge to the
// glyph's right edge; nudge it (and `top`) with a live screenshot until it
// lines up with the battery cluster. Kept as named constants so the QA pass
// is a one-line change.
const TOP_OFFSET = "calc(env(safe-area-inset-top, 0px) + 14px)";
const RIGHT_OFFSET = "141px";

// Only the child that actually draws requests gamescope composition, so we do
// NOT hold a Notification composition open when the profile is balanced/unknown
// (glyph === null) and nothing is on screen. useUIComposition stays an
// unconditional hook here — this component is only mounted when there is a glyph
// — so the rules of hooks hold while the composition cost is paid only when the
// overlay is visible.
function ComposedGlyph({ glyph }: { glyph: NonNullable<ReturnType<typeof profileGlyph>> }) {
  useUIComposition(UIComposition.Notification);
  return (
    <div
      style={{
        position: "fixed",
        top: TOP_OFFSET,
        right: RIGHT_OFFSET,
        zIndex: 7000,
        pointerEvents: "none",
        display: "flex",
        alignItems: "center",
        color: "#ffffff",
        opacity: 0.95,
      }}
    >
      {glyph}
    </div>
  );
}

export function TopBarProfileIndicator() {
  const profile = useActivePowerProfile();
  const glyph = profileGlyph(profile);
  if (!glyph) return null; // balanced / unreadable → nothing, no composition
  return <ComposedGlyph glyph={glyph} />;
}
