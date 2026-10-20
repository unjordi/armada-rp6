// Replaces the "Patch Notes" button of Steam's system-update field (Settings >
// System) with a modal of this OS's release notes.
//
// How it works:
//   * The field is a plain function component exported through a getter-only
//     webpack export, so the export itself cannot be wrapped. It is found with
//     findModuleExport by the localization tokens its source references.
//   * beforePatch on the shared jsx runtime swaps that component for
//     UpdateFieldWithNotes, which renders the original and overrides the
//     options-button props of the returned field element.
//   * The notes come from the armada-release-notes tool: the pending update's,
//     else the installed version's. With no notes the field is left untouched.
//
// The update-status component below the field (update_check_results plus
// "#Settings_System_Update_Available") is swapped the same way; its Valve news
// card (the child element with an `event` prop) is replaced by UpdateNotesCard
// while an update is pending. With no pending notes Steam's card is untouched.
//
// If a component or the jsx runtime is not found (a steamui refactor),
// install() logs once per component and changes nothing; the wrapper never throws into
// Steam's render. Notes are fetched when the field mounts and cached for 60 s.

import { beforePatch, findModule, findModuleExport } from "@decky/ui";
import { useEffect, useState } from "react";
import { getReleaseNotes } from "../backend";
import { openReleaseNotes } from "../components/ReleaseNotesModal";
import { useLocale } from "../hooks/useLocale";
import { t } from "../i18n";
import { UpdateNotesCard } from "../components/UpdateNotesCard";
import {
  isUpdateFieldSource,
  isUpdateStatusSource,
  componentMatcher,
  overrideProps,
  pickNotes,
  replaceElements,
  replacesNewsCard,
  type NotesSource,
} from "./releaseNotes";

interface LoadedNotes {
  source: NotesSource;
  markdown: string;
}

const CACHE_MS = 60_000;
let cache: { at: number; notes: LoadedNotes | null } | null = null;
let inflight: Promise<LoadedNotes | null> | null = null;

function loadNotes(): Promise<LoadedNotes | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return Promise.resolve(cache.notes);
  if (!inflight) {
    inflight = (async () => {
      const pending = await getReleaseNotes("pending").catch(() => "");
      const current = pending && pending.trim() ? "" : await getReleaseNotes("current").catch(() => "");
      const notes = pickNotes(pending, current);
      cache = { at: Date.now(), notes };
      return notes;
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

function useReleaseNotes(): LoadedNotes | null {
  const [notes, setNotes] = useState<LoadedNotes | null>(() => (cache ? cache.notes : null));
  useEffect(() => {
    let active = true;
    loadNotes()
      .then((loaded) => {
        if (active) setNotes(loaded);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return notes;
}

const warned = new Set<string>();
function warnOnce(key: string, ...args: unknown[]) {
  if (warned.has(key)) return;
  warned.add(key);
  try {
    console.warn("[armada-control:release-notes]", ...args);
  } catch {
    /* ignore */
  }
}

function findComponent(matches: (source: string) => boolean): ((props: any) => any) | null {
  try {
    const found = findModuleExport((e: any) => {
      if (typeof e !== "function") return false;
      try {
        return matches(Function.prototype.toString.call(e));
      } catch {
        return false;
      }
    });
    return typeof found === "function" ? found : null;
  } catch {
    return null;
  }
}

function findJsxRuntime(): any {
  const shared = (window as any).SP_JSX;
  if (shared && typeof shared.jsx === "function") return shared;
  try {
    return findModule((m: any) => m && typeof m.jsx === "function" && typeof m.jsxs === "function" && m.Fragment !== undefined);
  } catch {
    return null;
  }
}

const hasOptionsButton = (props: any) => "onOptionsButton" in props;

const hasEventProp = (props: any) => "event" in props;

export function installUpdateReleaseNotes(): () => void {
  const field = findComponent(isUpdateFieldSource);
  const status = componentMatcher(isUpdateStatusSource, findComponent(isUpdateStatusSource));
  const runtime = findJsxRuntime();
  if (!runtime) {
    warnOnce("runtime", "jsx runtime not found; Steam's update screen is left as it is");
    return () => {};
  }
  if (!field) warnOnce("field", "system-update field not found; Steam's patch notes button is left as it is");

  function UpdateFieldWithNotes(props: any) {
    useLocale();
    const notes = useReleaseNotes();
    const tree = field!(props);
    if (!notes) return tree;
    try {
      return overrideProps(tree, hasOptionsButton, {
        onOptionsButton: () => openReleaseNotes(notes.markdown, notes.source),
        onOptionsActionDescription: t("releaseNotes.button"),
      });
    } catch {
      return tree;
    }
  }

  function UpdateStatusWithNotes(props: any) {
    useLocale();
    const notes = useReleaseNotes();
    const tree = (status.found() as (p: any) => any)(props);
    if (!notes || !replacesNewsCard(notes)) return tree;
    try {
      return replaceElements(tree, hasEventProp, () => (
        <UpdateNotesCard markdown={notes.markdown} onOpen={() => openReleaseNotes(notes.markdown, notes.source)} />
      ));
    } catch {
      return tree;
    }
  }

  const swap = (args: any[]) => {
    if (field && args[0] === field) args[0] = UpdateFieldWithNotes;
    else if (args[0] !== UpdateStatusWithNotes && status.test(args[0])) args[0] = UpdateStatusWithNotes;
  };
  const patches = [beforePatch(runtime, "jsx", swap), beforePatch(runtime, "jsxs", swap)];
  return () => {
    for (const patch of patches) {
      try {
        patch.unpatch();
      } catch {
        /* already unpatched */
      }
    }
    cache = null;
  };
}
