// Turns whatever the Decky backend rejects a call with into a short,
// actionable message for a toast/inline banner -- never a raw stack trace,
// a bare exception class name, or Decky loader's generic "Python Exception"
// placeholder (that literal string reached a toast verbatim in the
// 2026-09-18 RGB QA: armada-rgb.service was crash-looping and every RGB
// action in the UI surfaced as "Could not change RGB lighting -- Python
// Exception", with zero clue what to do about it).
//
// The real fix lives on the backend (system_files/usr/libexec/armada/
// armada-control's run_rgb() and privileged.py's call() now translate known
// failure modes into clean RuntimeError messages before they cross the IPC
// boundary). This is the belt-and-suspenders frontend layer: it passes a
// clean backend message through unchanged, and replaces anything that looks
// like backend/loader noise with a generic, still-actionable fallback.

import { t } from "../i18n";

const NOISE_PATTERNS: RegExp[] = [
  // Decky loader's own generic placeholder when it can't forward a real message.
  /^python exception$/i,
  // A raw Python traceback slipped through uncaught.
  /^traceback \(most recent call last\)/i,
  // A bare exception class with no human message, e.g. "OSError" or "KeyError('x')".
  /^[A-Za-z_][A-Za-z0-9_.]*Error(\(.*\))?$/,
];

export function friendlyError(error: unknown, fallback = t("Something went wrong. Try again.")): string {
  const raw = (error instanceof Error ? error.message : String(error ?? "")).trim();
  if (!raw) return fallback;
  if (NOISE_PATTERNS.some((pattern) => pattern.test(raw))) return fallback;
  // Keep only the first line -- a multi-line message is traceback noise that
  // leaked through, not something a toast should render. Known backend
  // messages are translated; anything else is shown as the backend wrote it.
  const line = raw.split("\n")[0].trim();
  return line ? t(line) : fallback;
}
