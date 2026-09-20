import { definePlugin } from "@decky/api";
import { getCompatApplied, getConfig, getInstalledGames, saveCompatApplied } from "./backend";
import { ActiveProfileBadge } from "./components/ActiveProfileBadge";
import { Content } from "./Content";
import { installTopBarProfileIndicator } from "./lib/topBarProfileIndicator";
import {
  configureCompatPolicy,
  defaultWindowsCompatTool,
  getProtonTools,
  handledGameAppids,
  migrateWindowsCompatTool,
  registerDownloadWatcher,
  sweepInstalledGames,
} from "./lib/steamCompat";
import { factoryDefaultTransition } from "./lib/protonPolicy";

export default definePlugin(() => {
  let unregisterDownloadWatcher = () => {};
  const persistHandledGames = () => {
    saveCompatApplied(handledGameAppids()).catch(() => {});
  };
  // armada#25 (Camino 2 — INLINE, replaces the old position:fixed overlay):
  // patch Steam's own top-bar row so the live power-profile glyph flows as a
  // real sibling between the battery and the clock. Immune to clock/battery
  // width changes (1↔2-digit hour, charging icon, % width). See
  // lib/topBarProfileIndicator.tsx. Disposed in onDismount below.
  const removeTopBarGlyph = installTopBarProfileIndicator();
  let cancelled = false;
  const handledRequest = getCompatApplied()
    .then((state) => ({ state, loaded: true }))
    .catch(() => ({ state: { appids: [] as string[], protonDefault: "" }, loaded: false }));
  Promise.all([getConfig(), getInstalledGames(), handledRequest])
    .then(async ([config, games, handled]) => {
      await (window as any).App.WaitForServicesInitialized();
      if (cancelled) return;
      const explicitTool = config.tweaks?.global?.windowsCompatTool;
      configureCompatPolicy(
        explicitTool,
        handled.loaded && config.tweaks?.global?.autoApplyCompat !== false,
        handled.state.appids,
        config.protonDefaults,
      );
      const persist = handled.loaded ? persistHandledGames : () => {};
      unregisterDownloadWatcher = registerDownloadWatcher(persist);
      window.setTimeout(() => {
        void (async () => {
          if (cancelled) return;
          await sweepInstalledGames(games);
          if (cancelled) return;
          if (handled.loaded && !explicitTool) {
            const tools = await getProtonTools();
            if (cancelled) return;
            const nextTool = defaultWindowsCompatTool(tools, config.protonDefaults);
            const transition = factoryDefaultTransition(
              explicitTool, handled.loaded, handled.state.protonDefault, nextTool,
            );
            if (transition) {
              try {
                if (transition.oldTool !== transition.newTool) {
                  await migrateWindowsCompatTool(
                    games.filter((game) => !game.nonSteam).map((game) => game.appid),
                    transition.oldTool,
                    transition.newTool,
                  );
                }
                if (cancelled) return;
                await saveCompatApplied(handledGameAppids(), transition.newTool);
                return;
              } catch (error) {
              }
            }
          }
          persist();
        })().catch(() => {});
      }, 3000);
    })
    .catch(() => {});
  return {
    name: "Armada Control",
    content: <Content />,
    // armada#25 (partial -- see ActiveProfileBadge.tsx for what this does
    // and doesn't cover): live active-power-profile indicator.
    titleView: <ActiveProfileBadge />,
    onDismount() {
      cancelled = true;
      unregisterDownloadWatcher();
      removeTopBarGlyph?.();
    },
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 17H5" />
        <path d="M19 7h-9" />
        <circle cx="17" cy="17" r="3" />
        <circle cx="7" cy="7" r="3" />
      </svg>
    ),
    alwaysRender: true,
  };
});
