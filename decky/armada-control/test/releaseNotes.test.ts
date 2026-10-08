import assert from "node:assert/strict";
import test from "node:test";

import {
  isUpdateFieldSource,
  overrideProps,
  parseReleaseNotes,
  pickNotes,
  plainInline,
} from "../src/lib/releaseNotes.ts";

const NOTES = "## 20261007.abc1234\n\n- Better **fan** curve\n  Quiet by `default`.\n  Second line.\n- Plain item\n";

test("notes are parsed into version, items and details", () => {
  const parsed = parseReleaseNotes(NOTES);
  assert.equal(parsed.version, "20261007.abc1234");
  assert.deepEqual(parsed.blocks, [
    { kind: "heading", text: "20261007.abc1234" },
    { kind: "item", text: "Better fan curve", detail: "Quiet by default. Second line." },
    { kind: "item", text: "Plain item", detail: "" },
  ]);
});

test("notes without a heading have no version and keep free text", () => {
  const parsed = parseReleaseNotes("Just text\r\n- item");
  assert.equal(parsed.version, null);
  assert.deepEqual(parsed.blocks, [
    { kind: "text", text: "Just text" },
    { kind: "item", text: "item", detail: "" },
  ]);
});

test("empty and non-string input parse to nothing", () => {
  assert.deepEqual(parseReleaseNotes(""), { version: null, blocks: [] });
  assert.deepEqual(parseReleaseNotes(undefined as unknown as string), { version: null, blocks: [] });
});

test("inline markup is flattened", () => {
  assert.equal(plainInline("a **b** `c` [d](http://x)"), "a b c d");
});

test("pending notes win, installed notes are the fallback, none gives null", () => {
  assert.deepEqual(pickNotes("P", "C"), { source: "pending", markdown: "P" });
  assert.deepEqual(pickNotes("  ", "C"), { source: "current", markdown: "C" });
  assert.deepEqual(pickNotes("", null), null);
  assert.deepEqual(pickNotes(undefined, undefined), null);
});

test("the update field is recognised by its tokens, not other components", () => {
  const field = "function(){return t('#Settings_Updates_PatchNotes'),t('#Settings_Update_AutoRestartWhenComplete')}";
  assert.ok(isUpdateFieldSource(field));
  assert.ok(!isUpdateFieldSource("function(){return t('#Settings_Updates_PatchNotes')}"));
  assert.ok(!isUpdateFieldSource("function(){return 1}"));
});

test("overrideProps replaces matching props in a copy and leaves the original intact", () => {
  const field = { type: "Field", props: { label: "x", onOptionsButton: undefined, onOptionsActionDescription: undefined } };
  const tree = { type: "Fragment", props: { children: [field, { type: "Other", props: { y: 1 } }, null, "text"] } };
  const handler = () => {};
  const next = overrideProps(tree, (p) => "onOptionsButton" in p, { onOptionsButton: handler, onOptionsActionDescription: "Notes" });
  assert.equal(next.props.children[0].props.onOptionsButton, handler);
  assert.equal(next.props.children[0].props.onOptionsActionDescription, "Notes");
  assert.equal(next.props.children[0].props.label, "x");
  assert.equal(next.props.children[1], tree.props.children[1]);
  assert.equal(field.props.onOptionsButton, undefined);
  assert.notEqual(next, tree);
});

test("overrideProps returns the same tree when nothing matches", () => {
  const tree = { type: "Fragment", props: { children: [{ type: "A", props: { a: 1 } }] } };
  assert.equal(overrideProps(tree, (p) => "onOptionsButton" in p, { onOptionsButton: 1 }), tree);
});

test("overrideProps reaches a lone nested child", () => {
  const tree = { type: "Div", props: { children: { type: "Field", props: { onOptionsButton: undefined } } } };
  const next = overrideProps(tree, (p) => "onOptionsButton" in p, { onOptionsButton: 7 });
  assert.equal(next.props.children.props.onOptionsButton, 7);
});
