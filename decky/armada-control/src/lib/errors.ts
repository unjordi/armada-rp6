// Turns whatever the Decky backend rejects a call with into a short,
// actionable message for a toast or inline banner -- never a raw stack trace,
// a bare exception class name, or Decky loader's generic "Python Exception"
// placeholder.
//
// The backend (armada-control's run_rgb() and privileged.py's call())
// already turns known failures into clean messages before they cross the IPC
// boundary. This frontend layer passes a clean backend message through
// (translated when it is a known string) and replaces anything that looks
// like backend/loader noise with a generic, still-actionable fallback.

import { t, translateLabel } from "../i18n";

const NOISE_PATTERNS: RegExp[] = [
  // Decky loader's own generic placeholder when it can't forward a real message.
  /^python exception$/i,
  // A raw Python traceback slipped through uncaught.
  /^traceback \(most recent call last\)/i,
  // A bare exception class with no human message, e.g. "OSError" or "KeyError('x')".
  /^[A-Za-z_][A-Za-z0-9_.]*Error(\(.*\))?$/,
];

export function friendlyError(error: unknown, fallback = t("common.genericError")): string {
  const raw = (error instanceof Error ? error.message : String(error ?? "")).trim();
  if (!raw) return fallback;
  if (NOISE_PATTERNS.some((pattern) => pattern.test(raw))) return fallback;
  // Keep only the first line -- a multi-line message is traceback noise that
  // leaked through, not something a toast should render. Known backend
  // messages are translated; anything else is shown as the backend wrote it.
  const line = raw.split("\n")[0].trim();
  return line ? translateLabel(line) : fallback;
}
