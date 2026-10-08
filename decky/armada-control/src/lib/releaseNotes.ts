// Pure helpers for the release-notes override of Steam's system-update field.
// Notes format (build_files/release-notes.sh):
//   ## <version>
//   - <title>
//     <detail, one line>

export type NotesBlock =
  | { kind: "heading"; text: string }
  | { kind: "item"; text: string; detail: string }
  | { kind: "text"; text: string };

export interface ParsedNotes {
  version: string | null;
  blocks: NotesBlock[];
}

// Inline markup is shown as plain text.
export function plainInline(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .trim();
}

export function parseReleaseNotes(markdown: string): ParsedNotes {
  const blocks: NotesBlock[] = [];
  let version: string | null = null;
  for (const raw of String(markdown ?? "").split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(raw);
    if (heading) {
      const text = plainInline(heading[1]);
      if (version === null && text) version = text;
      blocks.push({ kind: "heading", text });
      continue;
    }
    const item = /^[-*]\s+(.*)$/.exec(raw);
    if (item) {
      blocks.push({ kind: "item", text: plainInline(item[1]), detail: "" });
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (/^\s+\S/.test(raw) && last && last.kind === "item") {
      last.detail = (last.detail ? last.detail + " " : "") + plainInline(raw);
      continue;
    }
    blocks.push({ kind: "text", text: plainInline(raw) });
  }
  return { version, blocks };
}

export type NotesSource = "pending" | "current";

// The pending update's notes win; the installed version's are the fallback.
export function pickNotes(
  pending: string | null | undefined,
  current: string | null | undefined,
): { source: NotesSource; markdown: string } | null {
  if (pending && pending.trim()) return { source: "pending", markdown: pending };
  if (current && current.trim()) return { source: "current", markdown: current };
  return null;
}

// True for the source of Steam's update-field component (Settings > System).
// Found by the localization tokens it renders, never by its minified name.
export function isUpdateFieldSource(source: string): boolean {
  return source.indexOf("#Settings_Updates_PatchNotes") >= 0
    && source.indexOf("#Settings_Update_AutoRestartWhenComplete") >= 0;
}

// Returns a copy of a React element tree where every element accepted by
// `match` has `override` merged into its props. Elements are never mutated.
export function overrideProps(node: any, match: (props: any) => boolean, override: Record<string, unknown>): any {
  if (Array.isArray(node)) {
    const mapped = node.map((child) => overrideProps(child, match, override));
    return mapped.every((child, i) => child === node[i]) ? node : mapped;
  }
  if (!node || typeof node !== "object" || !node.props) return node;
  let props = node.props;
  if (match(props)) props = { ...props, ...override };
  if (props.children !== undefined) {
    const children = overrideProps(props.children, match, override);
    if (children !== props.children) props = { ...props, children };
  }
  return props === node.props ? node : { ...node, props };
}
