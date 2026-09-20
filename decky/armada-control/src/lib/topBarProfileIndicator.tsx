// armada#25 (Camino 2 — INLINE, replaces the fixed overlay): a live
// power-profile glyph in the SYSTEM top bar (gamepadui), inserted as a real
// sibling immediately BEFORE the clock (i.e. between the battery cluster and
// the clock). Because it FLOWS inside Steam's own flex row instead of being a
// `position:fixed` overlay, it can never desync from the clock/battery when
// their widths change (1↔2-digit hour, charging icon appearing, % width).
//
// HOW IT WORKS (discovered live via CEF DevTools on the RP6, 2026-09-20 —
// steamui build Chrome/126, see docs/camino2-hojita.md):
//   * The top-bar row is rendered by a React.memo component we locate with
//     findModuleExport, filtering on THREE stable strings its inner render
//     references — "quickAccessHeader", "ControllerConfigurator", "VoiceChat"
//     — not on a minified export name (those change every steamui build).
//     Live, that resolved uniquely to module 62678 export "hB".
//   * That component returns (paraphrased):
//       <Provider><Row>{...icons..., <Battery/>, <ClockWrapper><Clock/></…>, …}</Row></Provider>
//     The Clock is the only element whose component source references BOTH
//     "DashboardBar" and "vrTooltip" — that is our stable anchor. We walk the
//     returned element tree, find the array item that renders the clock, and
//     splice our glyph in just before it.
//   * afterPatch(memo, "type", …) wraps the memo's inner render. React's
//     SimpleMemoComponent captures the render fn at MOUNT, so the glyph appears
//     the next time the top bar mounts (any navigation / QAM open / wake) —
//     the row re-mounts constantly in normal use.
//
// FALLBACK: if the module isn't found (a future steamui refactor) or the clock
// anchor moves, install() logs ONCE and renders nothing — it never throws into
// Steam's render. This break-on-major-update risk is accepted in the Decky
// ecosystem; the safe degradation is "no glyph", never a broken top bar.

import { afterPatch, findModuleExport } from "@decky/ui";
import { useActivePowerProfile } from "../hooks/useActivePowerProfile";

// Glyph size. ~12–16px reads as a peer of the native top-bar icons; kept as a
// named constant so a QA nudge is a one-liner. currentColor => inherits the
// bar's icon color (white) automatically.
const GLYPH_PX = 16;

function LeafGlyph() {
  return (
    <svg
      width={GLYPH_PX}
      height={GLYPH_PX}
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
      width={GLYPH_PX}
      height={GLYPH_PX}
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

// The glyph itself. Reactive: polls the live active power profile (armada#24)
// so it flips leaf/bolt/none as the profile changes, WITHOUT the top-bar
// component having to re-render. eco → leaf, performance → bolt, balanced /
// unknown / unreadable → nothing (no layout gap, since we flow inline). Never
// throws into Steam's render.
function ProfileGlyphSlot() {
  let profile = "";
  try {
    profile = useActivePowerProfile();
  } catch {
    return null;
  }
  let glyph: any = null;
  if (profile === "eco") glyph = <LeafGlyph />;
  else if (profile === "performance") glyph = <BoltGlyph />;
  if (!glyph) return null;
  return (
    <div
      className="armada-topbar-profile-glyph"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "currentColor",
        margin: "0 6px",
        pointerEvents: "none",
        alignSelf: "center",
      }}
    >
      {glyph}
    </div>
  );
}

// A React element renders the clock iff its component's source references BOTH
// "DashboardBar" and "vrTooltip" (the top-bar Clock component — stable across
// builds, unlike its minified name).
function isClockElement(el: any): boolean {
  if (!el || typeof el !== "object") return false;
  const t = el.type;
  if (typeof t !== "function") return false;
  try {
    const s = Function.prototype.toString.call(t);
    return s.indexOf("DashboardBar") >= 0 && s.indexOf("vrTooltip") >= 0;
  } catch {
    return false;
  }
}

// An array item "holds the clock" if it IS the clock or wraps the clock as its
// single child (the live tree wraps it: <tHWrapper>{<Clock/>}</tHWrapper>).
function holdsClock(el: any): boolean {
  if (!el || typeof el !== "object") return false;
  if (isClockElement(el)) return true;
  const kids = el.props && el.props.children;
  if (isClockElement(kids)) return true;
  return false;
}

// Recursively find the children ARRAY that contains the clock-holder and
// splice `glyph` right before it (=> between battery and clock). If the clock
// is a lone child rather than an array item, wrap it as [glyph, child].
// Returns true once inserted.
function insertBeforeClock(node: any, glyph: any): boolean {
  if (!node || typeof node !== "object") return false;
  const props = node.props;
  if (!props) return false;
  const kids = props.children;
  if (Array.isArray(kids)) {
    for (let i = 0; i < kids.length; i++) {
      if (holdsClock(kids[i])) {
        kids.splice(i, 0, glyph);
        return true;
      }
    }
    for (let i = 0; i < kids.length; i++) {
      if (insertBeforeClock(kids[i], glyph)) return true;
    }
    return false;
  }
  if (kids && typeof kids === "object") {
    if (holdsClock(kids)) {
      props.children = [glyph, kids];
      return true;
    }
    return insertBeforeClock(kids, glyph);
  }
  return false;
}

// Locate the top-bar row memo by three stable strings its inner render
// references. Returns the memo object (or a plain function, defensively).
function findTopBarComponent(): any {
  return findModuleExport((e: any) => {
    try {
      const fn =
        e && typeof e === "object" && typeof e.type === "function"
          ? e.type
          : typeof e === "function"
            ? e
            : null;
      if (!fn) return false;
      const s = Function.prototype.toString.call(fn);
      return (
        s.indexOf("quickAccessHeader") >= 0 &&
        s.indexOf("ControllerConfigurator") >= 0 &&
        s.indexOf("VoiceChat") >= 0
      );
    } catch {
      return false;
    }
  });
}

let warnedOnce = false;
function warnOnce(...args: any[]) {
  if (warnedOnce) return;
  warnedOnce = true;
  try {
    console.warn("[armada-control:topbar-glyph]", ...args);
  } catch {
    /* ignore */
  }
}

// Wire this from index.tsx's definePlugin(): call on mount, keep the returned
// disposer for onDismount. Returns null (and logs once) if the target can't be
// found — the plugin keeps working, just without the top-bar glyph.
export function installTopBarProfileIndicator(): (() => void) | null {
  let target: any;
  try {
    target = findTopBarComponent();
  } catch (e) {
    warnOnce("findModuleExport threw:", e);
    return null;
  }
  const isMemo = target && typeof target === "object" && typeof target.type === "function";
  if (!isMemo) {
    // On current steamui builds the top-bar row is a React.memo (we patch its
    // .type). If a future build exports it as a plain function, patching by
    // reference here wouldn't intercept Steam's own binding — bail cleanly
    // rather than pretend it's installed.
    warnOnce("top-bar module not found or not a memo; glyph not installed (steamui refactor?)");
    return null;
  }
  try {
    const patch = afterPatch(target, "type", (_args: any[], ret: any) => {
      try {
        insertBeforeClock(ret, <ProfileGlyphSlot key="armada-profile-glyph" />);
      } catch (e) {
        warnOnce("insertion failed; leaving top bar untouched:", e);
      }
      return ret;
    });
    return () => {
      try {
        patch.unpatch();
      } catch {
        /* ignore */
      }
    };
  } catch (e) {
    warnOnce("afterPatch failed:", e);
    return null;
  }
}
