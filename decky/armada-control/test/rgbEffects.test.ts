import assert from "node:assert/strict";
import test from "node:test";

import type { RgbEffect } from "../src/types.ts";
import {
  displayedEffect,
  EFFECT_OPTIONS,
  USES_BASE_COLOR,
  USES_SPEED,
} from "../src/lib/rgbEffects.ts";

test("screen_sync is offered in the dropdown", () => {
  assert.ok(
    EFFECT_OPTIONS.some((option) => option.data === "screen_sync"),
    "screen_sync must be a selectable effect",
  );
});

test("a persisted screen_sync is shown as itself, not 'Static'", () => {
  assert.equal(displayedEffect("screen_sync"), "screen_sync");
});

test("every offered effect round-trips through displayedEffect", () => {
  for (const option of EFFECT_OPTIONS) {
    assert.equal(displayedEffect(option.data), option.data);
  }
});

test("a genuinely unknown/future effect falls back to static", () => {
  assert.equal(displayedEffect("warp_drive" as RgbEffect), "static");
});

test("undefined effect falls back to static", () => {
  assert.equal(displayedEffect(undefined), "static");
});

test("effect option keys are unique", () => {
  const keys = EFFECT_OPTIONS.map((option) => option.data);
  assert.equal(new Set(keys).size, keys.length);
});

test("screen_sync derives its own color and cadence, so it uses neither base color nor the speed slider", () => {
  assert.ok(!USES_BASE_COLOR.includes("screen_sync"), "color is sampled from the screen");
  assert.ok(!USES_SPEED.includes("screen_sync"), "screen_sync sets its own cadence");
});
