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
// If the component or the jsx runtime is not found (a steamui refactor),
// install() logs once and changes nothing; the wrapper never throws into
// Steam's render. Notes are fetched when the field mounts and cached for 60 s.

import { beforePatch, findModule, findModuleExport } from "@decky/ui";
import { useEffect, useState } from "react";
import { getReleaseNotes } from "../backend";
import { openReleaseNotes } from "../components/ReleaseNotesModal";
import { useLocale } from "../hooks/useLocale";
import { t } from "../i18n";
import { isUpdateFieldSource, overrideProps, pickNotes, type NotesSource } from "./releaseNotes";

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

let warnedOnce = false;
function warnOnce(...args: unknown[]) {
  if (warnedOnce) return;
  warnedOnce = true;
  try {
    console.warn("[armada-control:release-notes]", ...args);
  } catch {
    /* ignore */
  }
}

function findUpdateField(): ((props: any) => any) | null {
  try {
    const found = findModuleExport((e: any) => {
      if (typeof e !== "function") return false;
      try {
        return isUpdateFieldSource(Function.prototype.toString.call(e));
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

export function installUpdateReleaseNotes(): () => void {
  const original = findUpdateField();
  const runtime = findJsxRuntime();
  if (!original || !runtime) {
    warnOnce("system-update field or jsx runtime not found; Steam's patch notes are left as they are");
    return () => {};
  }

  function UpdateFieldWithNotes(props: any) {
    useLocale();
    const notes = useReleaseNotes();
    const tree = original!(props);
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

  const swap = (args: any[]) => {
    if (args[0] === original) args[0] = UpdateFieldWithNotes;
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
