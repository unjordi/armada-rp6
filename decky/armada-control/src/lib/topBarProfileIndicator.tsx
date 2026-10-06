// A live power-profile glyph in Steam's own top bar (gamepadui), inserted as a
// real sibling right before the clock, so it flows with the battery and clock
// instead of being an overlay that drifts when their widths change.
//
// How it works:
//   * The top-bar row is a React.memo found with findModuleExport by two stable
//     strings its render references ("ControllerConfigurator" and "VoiceChat"),
//     never by its minified export name.
//   * afterPatch(memo, "type", ...) wraps its render; in the returned tree the
//     clock is the element whose component source references both
//     "DashboardBar" and "vrTooltip", and the glyph is spliced in before it.
//   * The bar mounts before this plugin loads and a SimpleMemoComponent keeps
//     the render it resolved at mount, so the patch alone only reaches future
//     mounts. forceBarRerender/startMaterializer re-render the mounted bar once.
//
// If the module is not found (a steamui refactor) or the re-render cannot run,
// install() logs once and renders nothing; it never throws into Steam's render.
// Background and live findings: the rp6-armada-manual skill, chapter 07.

import { afterPatch, findModuleExport } from "@decky/ui";
import { useEffect, useState } from "react";
import { getActivePowerProfile } from "../backend";
import { useActivePowerProfile } from "../hooks/useActivePowerProfile";
import { looksLikeClock } from "./topBarClock";

// Module-level profile cache. The top-bar memo can (re)render at any moment
// (a re-mount, a QAM open, our forced re-render). If ProfileGlyphSlot mounted
// with an empty seed it would render `null` for the first ~3s (until its own
// poll resolves) and, because each memo render creates a FRESH slot instance,
// it would never get past that null window on a bar that renders sporadically.
// So we keep a live cached value here (seeded before the glyph ever mounts)
// and seed the slot with it => the correct glyph paints on the very first
// render. eco → leaf, performance → bolt, else nothing.
let cachedProfile = "";
let profileTimer: ReturnType<typeof setInterval> | null = null;
function startProfilePolling(): void {
  if (profileTimer) return;
  const poll = () => {
    getActivePowerProfile()
      .then((p) => {
        cachedProfile = p || "";
      })
      .catch(() => {
        /* transient read failure — keep the last known value */
      });
  };
  poll();
  profileTimer = setInterval(poll, 3000);
}
function stopProfilePolling(): void {
  if (profileTimer) clearInterval(profileTimer);
  profileTimer = null;
}

// Glyph geometry is per-device and comes from the device conf
// (ARMADA_UI_TOPBAR_INDICATOR_SIZE_PX / _MARGIN_PX), delivered with the plugin
// config. A device without the keys keeps these defaults. currentColor =>
// inherits the bar's icon color (white) automatically.
export interface IndicatorGeometry {
  sizePx: number;
  marginPx: number;
}
const DEFAULT_GEOMETRY: IndicatorGeometry = { sizePx: 16, marginPx: 6 };

let geometry: IndicatorGeometry = DEFAULT_GEOMETRY;
const geometryListeners = new Set<(next: IndicatorGeometry) => void>();

function pixels(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

// Called once the plugin config arrives. The glyph may already be on screen
// with the defaults, so subscribers re-render with the device values.
export function setTopBarIndicatorGeometry(raw?: { sizePx?: string; marginPx?: string } | null): void {
  geometry = {
    sizePx: pixels(raw?.sizePx, DEFAULT_GEOMETRY.sizePx),
    marginPx: pixels(raw?.marginPx, DEFAULT_GEOMETRY.marginPx),
  };
  geometryListeners.forEach((listener) => listener(geometry));
}

function useIndicatorGeometry(): IndicatorGeometry {
  const [current, setCurrent] = useState(geometry);
  useEffect(() => {
    geometryListeners.add(setCurrent);
    setCurrent(geometry);
    return () => {
      geometryListeners.delete(setCurrent);
    };
  }, []);
  return current;
}

function LeafGlyph({ px }: { px: number }) {
  return (
    <svg
      width={px}
      height={px}
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

function BoltGlyph({ px }: { px: number }) {
  return (
    <svg
      width={px}
      height={px}
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

// The glyph itself. Reactive: polls the live active power profile
// so it flips leaf/bolt/none as the profile changes, WITHOUT the top-bar
// component having to re-render. eco → leaf, performance → bolt, balanced /
// unknown / unreadable → nothing (no layout gap, since we flow inline). Never
// throws into Steam's render.
function ProfileGlyphSlot() {
  let profile = "";
  let size: IndicatorGeometry = geometry;
  try {
    size = useIndicatorGeometry();
    // Seed with the module-level cache so the correct glyph paints on the
    // FIRST render (no null-until-poll window). The hook keeps it live after.
    profile = useActivePowerProfile(cachedProfile);
  } catch {
    return null;
  }
  let glyph: any = null;
  if (profile === "eco") glyph = <LeafGlyph px={size.sizePx} />;
  else if (profile === "performance") glyph = <BoltGlyph px={size.sizePx} />;
  if (!glyph) return null;
  return (
    <div
      className="armada-topbar-profile-glyph"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "currentColor",
        margin: `0 ${size.marginPx}px`,
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

// Locate the top-bar row memo by stable strings its inner render references
// (not by minified export name, which changes every steamui build). Returns
// the memo object (or a plain function, defensively).
//
// If a future steamui refactor breaks this signature, install() logs once and
// renders nothing (never a broken bar).
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

// --- Forcing the ALREADY-MOUNTED bar to pick up the patch --------------------
// We run in Decky's SharedJSContext; the visible top bar renders in a separate
// document (the BPM popup, reachable via g_PopupManager). Re-render the mounted
// row memo once from here so it runs the patched `.type`; later mounts pick it
// up on their own.

function findClockNode(doc: Document): any {
  try {
    const all = doc.querySelectorAll("*");
    for (let i = 0; i < all.length; i++) {
      const e: any = all[i];
      const t =
        e.childNodes.length === 1 && e.firstChild && e.firstChild.nodeType === 3
          ? (e.textContent || "").trim()
          : "";
      if (looksLikeClock(t)) return e;
    }
  } catch {
    /* ignore */
  }
  return null;
}

// The document that actually renders the visible top bar. Steam keeps its
// windows in g_PopupManager; the bar lives in the one whose DOM has the clock.
function barDocument(): Document | null {
  try {
    const pm: any = (window as any).g_PopupManager;
    if (!pm || typeof pm.GetPopups !== "function") return null;
    const popups = pm.GetPopups() || [];
    for (const p of popups) {
      let d: any = null;
      try {
        d = (p && p.m_popup && p.m_popup.document) || (p && p.window && p.window.document);
      } catch {
        /* some popups guard cross-origin-ish access */
      }
      if (d && typeof d.querySelector === "function" && findClockNode(d)) return d;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function fiberOf(el: any): any {
  for (const k in el) {
    if (k.indexOf("__reactFiber$") === 0) return (el as any)[k];
  }
  return null;
}

// Force the mounted row memo (the one we patched, identified by object identity
// or its decky marker) to re-render, so React runs our patched `.type`. Returns
// true once a forced re-render was dispatched (or the glyph is already present).
// Fully defensive: any failure => returns false and leaves the bar untouched.
function forceBarRerender(target: any): boolean {
  try {
    const doc = barDocument();
    if (!doc) return false;
    if (doc.querySelector(".armada-topbar-profile-glyph")) return true; // already showing
    const clock = findClockNode(doc);
    if (!clock) return false;
    let f = fiberOf(clock);
    let memoFib: any = null;
    let hops = 0;
    while (f && hops < 60) {
      hops++;
      const et = f.elementType;
      if (et && typeof et === "object" && et.$$typeof && String(et.$$typeof).indexOf("memo") >= 0) {
        try {
          if (et === target || (et.type && et.type.__deckyPatch)) {
            memoFib = f;
            break;
          }
        } catch {
          /* ignore */
        }
      }
      f = f.return;
    }
    if (!memoFib) return false;
    const wrapper = memoFib.elementType.type; // our afterPatch wrapper
    // Point the fiber's cached inner render at the wrapper and defeat the
    // SimpleMemoComponent bail-out so the forced re-render actually runs it.
    for (const fib of [memoFib, memoFib.alternate]) {
      if (!fib) continue;
      try {
        fib.type = wrapper;
      } catch {
        /* ignore */
      }
      try {
        fib.memoizedProps = Object.assign({ __armadaNudge: Math.random() }, fib.memoizedProps || {});
      } catch {
        /* ignore */
      }
    }
    // Schedule the re-render via the nearest class-component ancestor (on the
    // live RP6 build it sits ~2 hops up).
    let g = memoFib;
    let guard = 0;
    while (g && guard < 80) {
      guard++;
      const sn = g.stateNode;
      if (sn && typeof sn.forceUpdate === "function") {
        try {
          sn.forceUpdate();
          return true;
        } catch {
          /* try the next ancestor */
        }
      }
      g = g.return;
    }
  } catch {
    /* ignore */
  }
  return false;
}

// Bounded materializer: heals the initially-mounted bar. Stops as soon as the
// glyph node exists (eco/performance) or a forced re-render has run (balanced =
// correctly no glyph), or after ~20s. Returns a disposer.
function startMaterializer(target: any): () => void {
  let mtimer: ReturnType<typeof setInterval> | null = null;
  let tries = 0;
  const MAX = 40; // ~20s at 500ms
  const stop = () => {
    if (mtimer) {
      clearInterval(mtimer);
      mtimer = null;
    }
  };
  const tick = () => {
    tries++;
    let forced = false;
    try {
      forced = forceBarRerender(target);
    } catch {
      /* ignore */
    }
    let present = false;
    try {
      const doc = barDocument();
      present = !!(doc && doc.querySelector(".armada-topbar-profile-glyph"));
    } catch {
      /* ignore */
    }
    // Done when the glyph is on screen, or we forced a render but no glyph is
    // expected (balanced/unknown profile), or we ran out of attempts.
    const noGlyphExpected = cachedProfile !== "eco" && cachedProfile !== "performance";
    if (present || (forced && noGlyphExpected) || tries >= MAX) stop();
  };
  mtimer = setInterval(tick, 500);
  tick();
  return stop;
}

// Wire this from index.tsx's definePlugin(): call on mount, keep the returned
// disposer for onDismount. Returns a disposer (never null) — even if the
// module isn't ready yet.
//
// RETRY: the top-bar row memo is LAZILY instantiated — if `findModuleExport`
// returns nothing at plugin-load (module not in webpack's cache yet) we poll
// until it resolves, then afterPatch once. If it never resolves (a steamui
// refactor), we log once and render nothing — never a broken bar.
export function installTopBarProfileIndicator(): () => void {
  let patch: { unpatch: () => void } | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopMaterializer: (() => void) | null = null;
  let attempts = 0;
  const MAX_ATTEMPTS = 60; // ~30s at 500ms — covers a slow lazy-load / cold boot

  // Keep the live profile fresh before the glyph ever mounts.
  startProfilePolling();

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
          insertBeforeClock(ret, <ProfileGlyphSlot key="armada-profile-glyph" />);
        } catch (e) {
          warnOnce("insertion failed; leaving top bar untouched:", e);
        }
        return ret;
      });
      // The patch only affects FUTURE mounts (React's SimpleMemoComponent cached
      // the pre-patch render at mount, and the bar mounts before we load), so
      // force the already-mounted bar to re-render now => glyph appears with no
      // user interaction. Future re-mounts pick up the patched .type on their own.
      if (stopMaterializer) stopMaterializer();
      stopMaterializer = startMaterializer(target);
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
    if (stopMaterializer) {
      stopMaterializer();
      stopMaterializer = null;
    }
    stopProfilePolling();
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
