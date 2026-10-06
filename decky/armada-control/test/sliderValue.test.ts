import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// The privileged actions validate slider values as ints (sync_scale, speed,
// charge brightness). SliderEdit used to pass format(value) — e.g. "50%" — to
// onChange, so the backend rejected every move. Display suffixes go through
// valueSuffix; onChange must get the slider's number untouched.

const src = new URL("../src/", import.meta.url).pathname;
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : []);

test("SliderEdit hands onChange the slider's number, not a formatted string", () => {
  const widgets = readFileSync(join(src, "components/widgets.tsx"), "utf8");
  const body = widgets.slice(widgets.indexOf("export function SliderEdit"));
  assert.match(body, /onChange=\{\(next\) => onChange\(next\)\}/);
  assert.doesNotMatch(body.slice(0, body.indexOf("\n}\n")), /format\(/);
});

test("no SliderEdit is given a value-transforming format prop", () => {
  for (const f of files(src)) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/<SliderEdit\b[\s\S]*?\/>/g)) {
      assert.doesNotMatch(m[0], /\bformat=/, `${f}: ${m[0].slice(0, 80)}`);
    }
  }
});
