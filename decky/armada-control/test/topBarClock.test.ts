import assert from "node:assert/strict";
import test from "node:test";

import { looksLikeClock } from "../src/lib/topBarClock.ts";

test("the top-bar clock is recognised in every Steam UI language format", () => {
  for (const text of ["9:41", "21:05", "9:41 PM", "9:41AM", "9:41 p. m.", "9:41 a.m.", "9:41 p. m."]) {
    assert.ok(looksLikeClock(text), text);
  }
});

test("other top-bar text is not taken for the clock", () => {
  for (const text of ["100%", "9:41:07", "Wi-Fi", "12", "9:4", "p. m."]) {
    assert.ok(!looksLikeClock(text), text);
  }
});
