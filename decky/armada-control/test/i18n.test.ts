import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { hasSpanish, resolveLocale, setLocale, t, tLabel } from "../src/i18n.ts";
import { EFFECT_OPTIONS } from "../src/lib/rgbEffects.ts";

const SRC = new URL("../src/", import.meta.url).pathname;
const REPO = new URL("../../../", import.meta.url).pathname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && name !== "i18n.ts" ? [path] : [];
  });
}

test("Steam's language picks the locale, in either of its spellings", () => {
  assert.equal(resolveLocale(["es-419"]), "es");
  assert.equal(resolveLocale(["es-MX"]), "es");
  assert.equal(resolveLocale(["es"]), "es");
  assert.equal(resolveLocale(["latam"]), "es");
  assert.equal(resolveLocale(["spanish"]), "es");
  assert.equal(resolveLocale(["en"]), "en");
  assert.equal(resolveLocale(["en-US"]), "en");
});

test("the first reported language decides; unknown languages fall back to English", () => {
  // Steam set to French while the browser says Spanish: Steam wins, and we
  // don't ship French.
  assert.equal(resolveLocale(["fr", "es-MX"]), "en");
  // No Steam language: the browser's is used.
  assert.equal(resolveLocale([undefined, "es-MX"]), "es");
  assert.equal(resolveLocale(["", "es"]), "es");
  assert.equal(resolveLocale([]), "en");
});

test("t() translates, fills placeholders, and falls back to the English text", () => {
  setLocale("es");
  assert.equal(t("Save Changes"), "Guardar cambios");
  assert.equal(t("Used by: {profiles}", { profiles: "Ahorro, Rendimiento" }), "La usan: Ahorro, Rendimiento");
  assert.equal(t("A string nobody translated"), "A string nobody translated");
  setLocale("en");
  assert.equal(t("Save Changes"), "Save Changes");
  assert.equal(t("Used by: {profiles}", { profiles: "Eco" }), "Used by: Eco");
});

test("tLabel() keeps a trailing detail such as a cpulist", () => {
  setLocale("es");
  assert.equal(tLabel("Big Cores (3-7)"), "Núcleos grandes (3-7)");
  assert.equal(tLabel("Balanced"), "Equilibrado");
  assert.equal(tLabel("My Curve (copy)"), "My Curve (copy)");
  setLocale("en");
});

test("every string the UI passes to t() has a Spanish translation", () => {
  const missing: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) {
      const key = match[1].replace(/\\"/g, '"');
      if (!hasSpanish(key)) missing.push(`${file.slice(SRC.length)}: ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("labels that come from data files and the system service have translations", () => {
  const labels = new Set<string>(EFFECT_OPTIONS.map((option) => option.label));
  const profiles = readFileSync(join(REPO, "system_files/usr/share/armada/power-profiles.conf"), "utf8");
  for (const match of profiles.matchAll(/^label=(.+)$/gm)) labels.add(match[1].trim());
  const fex = JSON.parse(readFileSync(join(REPO, "system_files/usr/share/armada/fex-profiles.json"), "utf8"));
  for (const profile of Object.values<any>(fex.profiles ?? fex)) if (profile?.label) labels.add(profile.label);
  const service = readFileSync(join(REPO, "system_files/usr/libexec/armada/armada-control"), "utf8");
  const sleep = /SLEEP_MODE_LABELS = \{([^}]*)\}/.exec(service);
  assert.ok(sleep, "SLEEP_MODE_LABELS not found in armada-control");
  for (const match of sleep[1].matchAll(/:\s*"([^"]+)"/g)) labels.add(match[1]);
  const system = readFileSync(join(REPO, "decky/armada-control/py_modules/armada_control/system.py"), "utf8");
  for (const match of system.matchAll(/\("\w+", "([^"]+)", "ARMADA_\w+"\)/g)) labels.add(match[1]);
  labels.add("All Cores");
  assert.ok(labels.size > 15, `only found ${labels.size} labels; the parsing above broke`);
  assert.deepEqual([...labels].filter((label) => !hasSpanish(label)), []);
});

test("components don't render bare English text", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC).filter((path) => path.endsWith(".tsx"))) {
    const text = readFileSync(file, "utf8");
    // JSX text children, and text-bearing props set to a string literal.
    const patterns = [
      />\s*([A-Za-z][^<>{}]*?)\s*<\//g,
      /\b(?:label|title|description|placeholder)="([^"]*[A-Za-z][^"]*)"/g,
    ];
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) offenders.push(`${file.slice(SRC.length)}: ${match[1].trim()}`);
    }
  }
  assert.deepEqual(offenders, []);
});
