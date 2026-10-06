// The top-bar clock as text, in any of Steam's UI languages: "9:41", "21:05",
// "9:41 PM", or the Spanish "9:41 p. m.". Pure, so it is unit-tested without a DOM.
const CLOCK_RE = /^\d{1,2}:\d{2}(?:\s?[ap]\.?\s?m\.?)?$/i;

export function looksLikeClock(text: string): boolean {
  return CLOCK_RE.test(text.replace(/ | /g, " ").trim());
}
