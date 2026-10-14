import assert from "node:assert/strict";
import test from "node:test";

import {
  compactNotes,
  componentMatcher,
  isUpdateFieldSource,
  isUpdateStatusSource,
  overrideProps,
  parseReleaseNotes,
  pickNotes,
  replaceElements,
  replacesNewsCard,
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

test("the update status component is recognised by its tokens", () => {
  const status = "function q(){const r=s.m_updateState?.update_check_results;return t('#Settings_System_Update_Available')}";
  assert.ok(isUpdateStatusSource(status));
  assert.ok(!isUpdateStatusSource("function(){return t('#Settings_System_Update_Available')}"));
  assert.ok(!isUpdateStatusSource("function(){return x.update_check_results}"));
  assert.ok(!isUpdateStatusSource("function(){return t('#Settings_Updates_PatchNotes'),t('#Settings_Update_AutoRestartWhenComplete')}"));
});

test("only pending notes replace the news card; installed notes leave it", () => {
  assert.equal(replacesNewsCard({ source: "pending" }), true);
  assert.equal(replacesNewsCard({ source: "current" }), false);
  assert.equal(replacesNewsCard(null), false);
  assert.deepEqual(pickNotes("", "C"), { source: "current", markdown: "C" });
  assert.equal(replacesNewsCard(pickNotes("", "C")), false);
});

test("replaceElements swaps the event child in a copy, keeping the siblings", () => {
  const news = { type: "Card", props: { event: { id: 1 } } };
  const row = { type: "Row", props: { name: "x" } };
  const tree = { type: "Group", props: { children: [false, news, [row]] } };
  const mine = { type: "Mine", props: {} };
  const next = replaceElements(tree, (p) => "event" in p, () => mine);
  assert.equal(next.props.children[1], mine);
  assert.equal(next.props.children[2], tree.props.children[2]);
  assert.equal(tree.props.children[1], news);
  assert.notEqual(next, tree);
});

test("replaceElements finds a lone nested child and returns the same tree on no match", () => {
  const tree = { type: "A", props: { children: { type: "B", props: { children: { type: "Card", props: { event: 1 } } } } } };
  const next = replaceElements(tree, (p) => "event" in p, () => "X");
  assert.equal(next.props.children.props.children, "X");
  const none = { type: "A", props: { children: [{ type: "B", props: { y: 1 } }] } };
  assert.equal(replaceElements(none, (p) => "event" in p, () => "X"), none);
  assert.equal(replaceElements(null, () => true, () => "X"), null);
});

test("compact notes list entry titles, cap the lines and count the hidden ones", () => {
  const md = "## 1.2\n" + Array.from({ length: 9 }, (_, i) => `- Item ${i + 1}\n  detail ${i + 1}`).join("\n");
  const compact = compactNotes(md);
  assert.equal(compact.version, "1.2");
  assert.deepEqual(compact.lines, ["Item 1", "Item 2", "Item 3", "Item 4", "Item 5", "Item 6"]);
  assert.equal(compact.hidden, 3);
  assert.deepEqual(compactNotes("## v\n- only"), { version: "v", lines: ["only"], hidden: 0 });
  assert.deepEqual(compactNotes(""), { version: null, lines: [], hidden: 0 });
});

test("componentMatcher finds a non-exported component by its source and remembers it", () => {
  const isStatus = (src: string) => src.includes("update_check_results") && src.includes("#Settings_System_Update_Available");
  function Status() { return ["update_check_results", "#Settings_System_Update_Available"]; }
  function Other() { return "#Settings_Updates_Title"; }
  const m = componentMatcher(isStatus);
  assert.equal(m.found(), null);
  assert.equal(m.test("div"), false);
  assert.equal(m.test(Other), false);
  assert.equal(m.test(Status), true);
  assert.equal(m.found(), Status);
  function Twin() { return ["update_check_results", "#Settings_System_Update_Available"]; }
  assert.equal(m.test(Twin), false);
});

test("componentMatcher with an initial component only matches that one", () => {
  function Exported() { return 1; }
  function Status() { return ["update_check_results", "#Settings_System_Update_Available"]; }
  const m = componentMatcher((s) => s.includes("update_check_results"), Exported);
  assert.equal(m.test(Exported), true);
  assert.equal(m.test(Status), false);
});
