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
//     findModuleExport, filtering on the stable strings its inner render
//     references — "ControllerConfigurator" AND "VoiceChat" — not on a minified
//     export name (those change every steamui build). Live (Chrome/126,
//     2026-09-20) that resolved uniquely to ONE memo export. (An earlier build
//     also had "quickAccessHeader" in this memo, but it moved to the QuickAccess
//     module, so requiring it matched nothing — see findTopBarComponent.)
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

// Our glyph carries a stable key so we can recognize it if it's already in the
// tree. This is the idempotency marker (audit M3).
const GLYPH_KEY = "armada-profile-glyph";
function isOurGlyph(el: any): boolean {
  return !!el && typeof el === "object" && el.key === GLYPH_KEY;
}

// Recursively find the children ARRAY that contains the clock-holder and
// splice `glyph` right before it (=> between battery and clock). If the clock
// is a lone child rather than an array item, wrap it as [glyph, child].
// Returns true once inserted (or once we confirm it's ALREADY inserted).
//
// IDEMPOTENCY (audit M3): afterPatch runs on EVERY render of the memo. Today
// React.createElement hands us a FRESH children array per render, so a plain
// splice is safe. But if a future steamui build memoizes/reuses that array,
// splicing every render would stack duplicate glyphs. So before inserting we
// check whether our keyed glyph is already present in the array and, if so,
// treat it as done -- never insert a second one.
function insertBeforeClock(node: any, glyph: any): boolean {
  if (!node || typeof node !== "object") return false;
  const props = node.props;
  if (!props) return false;
  const kids = props.children;
  if (Array.isArray(kids)) {
    // Already ours? A reused/memoized array would still hold it — don't dupe.
    if (kids.some(isOurGlyph)) return true;
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
    if (isOurGlyph(kids)) return true; // already just our glyph — nothing to do
    if (holdsClock(kids)) {
      props.children = [glyph, kids];
      return true;
    }
    return insertBeforeClock(kids, glyph);
  }
  return false;
}

// Locate the top-bar row memo by stable strings its inner render references
// (not by minified export name, which changes every steamui build). Returns
// the memo object (or a plain function, defensively).
//
// Filter = "ControllerConfigurator" AND "VoiceChat": on the live RP6 build
// (steamui Chrome/126, 2026-09-20) those two co-locate in EXACTLY ONE memo
// export (the top-bar row) — verified via CDP: `findAllModules` finds a single
// memo whose source has both. We deliberately do NOT also require
// "quickAccessHeader": in this build that string is NO LONGER in the row memo
// (it moved to the QuickAccess module `DT`), so the old 3-string AND matched
// NOTHING and the glyph never installed. The 2-string filter is the current
// unique signature; if a future steamui refactor breaks it, install() logs
// once and renders nothing (never a broken bar — see the fallback below).
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
      return s.indexOf("ControllerConfigurator") >= 0 && s.indexOf("VoiceChat") >= 0;
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
// disposer for onDismount. Returns a disposer (never null) — even if the
// module isn't ready yet.
//
// RETRY (the QG-8/#25 mount fix): the top-bar row memo is LAZILY instantiated
// — at plugin-load time (early in the session) `findModuleExport` returns
// nothing because the module isn't in webpack's cache yet, so a one-shot
// install silently never patches (verified on device: module found later but
// `__deckyPatch` false). So we poll until the module resolves, then afterPatch
// once. Once patched, the shared memo carries the glyph into every subsequent
// mount of the bar (a navigation / QAM open / fresh boot). If it never resolves
// (a steamui refactor), we log once and render nothing — never a broken bar.
export function installTopBarProfileIndicator(): () => void {
  let patch: { unpatch: () => void } | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let attempts = 0;
  const MAX_ATTEMPTS = 60; // ~30s at 500ms — covers a slow lazy-load / cold boot

  // Returns true when we should STOP trying (patched, or a hard failure);
  // false means "not ready, keep polling".
  const tryInstall = (): boolean => {
    let target: any;
    try {
      target = findTopBarComponent();
    } catch (e) {
      warnOnce("findModuleExport threw:", e);
      return true;
    }
    if (!target) return false; // module not instantiated yet — keep polling
    const isMemo = target && typeof target === "object" && typeof target.type === "function";
    if (!isMemo) {
      // Current steamui builds export the row as a React.memo (we patch its
      // .type). A plain-function export would need a different hook; bail
      // cleanly rather than pretend it's installed.
      warnOnce("top-bar module found but not a memo; glyph not installed (steamui refactor?)");
      return true;
    }
    try {
      patch = afterPatch(target, "type", (_args: any[], ret: any) => {
        try {
          insertBeforeClock(ret, <ProfileGlyphSlot key={GLYPH_KEY} />);
        } catch (e) {
          warnOnce("insertion failed; leaving top bar untouched:", e);
        }
        return ret;
      });
    } catch (e) {
      warnOnce("afterPatch failed:", e);
    }
    return true;
  };

  if (!tryInstall()) {
    timer = setInterval(() => {
      attempts++;
      if (tryInstall() || attempts >= MAX_ATTEMPTS) {
        if (timer) clearInterval(timer);
        timer = null;
        if (attempts >= MAX_ATTEMPTS && !patch) {
          warnOnce("top-bar module not found after retries; glyph not installed");
        }
      }
    }, 500);
  }

  return () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (patch) {
      try {
        patch.unpatch();
      } catch {
        /* ignore */
      }
      patch = null;
    }
  };
}
