import { Focusable } from "@decky/ui";
import { t } from "../i18n";
import { compactNotes } from "../lib/releaseNotes";

// Compact release-notes card shown in place of Steam's news card; activating it opens the full notes.
export function UpdateNotesCard({ markdown, onOpen }: { markdown: string; onOpen: () => void }) {
  const { version, lines, hidden } = compactNotes(markdown);
  const title = version ? t("releaseNotes.title", { version }) : t("releaseNotes.titleNoVersion");
  return (
    <Focusable onActivate={onOpen} style={{ padding: "12px 16px", borderRadius: "4px", background: "rgba(255,255,255,0.06)" }}>
      <div style={{ fontSize: "16px", fontWeight: 600, marginBottom: "6px" }}>{title}</div>
      {lines.map((line, index) => (
        <div key={index} style={{ fontSize: "13px", lineHeight: "18px", opacity: 0.85 }}>{`• ${line}`}</div>
      ))}
      {hidden > 0 ? <div style={{ fontSize: "12px", opacity: 0.6, marginTop: "4px" }}>{t("releaseNotes.more", { count: hidden })}</div> : null}
    </Focusable>
  );
}
