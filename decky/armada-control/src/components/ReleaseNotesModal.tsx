import { DialogBody, DialogButton, DialogFooter, Focusable, ModalRoot, showModal } from "@decky/ui";
import { t } from "../i18n";
import { parseReleaseNotes, type NotesSource } from "../lib/releaseNotes";

function ReleaseNotesModal({ markdown, source, closeModal }: { markdown: string; source: NotesSource; closeModal?: () => void }) {
  const { version, blocks } = parseReleaseNotes(markdown);
  const title = version ? t("releaseNotes.title", { version }) : t("releaseNotes.titleNoVersion");
  const kind = source === "pending" ? t("releaseNotes.pending") : t("releaseNotes.installed");
  return (
    <ModalRoot onCancel={() => closeModal?.()}>
      <DialogBody>
        <h2 style={{ margin: "0 0 4px" }}>{title}</h2>
        <div style={{ fontSize: "13px", opacity: 0.7, marginBottom: "14px" }}>{kind}</div>
        {blocks.map((block, index) => {
          if (block.kind === "heading") return null;
          const detail = block.kind === "item" && block.detail ? block.detail : "";
          return (
            <Focusable key={index} style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "15px", fontWeight: block.kind === "item" ? 600 : 400, lineHeight: "20px" }}>
                {block.kind === "item" ? `• ${block.text}` : block.text}
              </div>
              {detail ? <div style={{ fontSize: "13px", opacity: 0.75, lineHeight: "18px", marginLeft: "14px" }}>{detail}</div> : null}
            </Focusable>
          );
        })}
      </DialogBody>
      <DialogFooter>
        <DialogButton onClick={() => closeModal?.()}>{t("common.close")}</DialogButton>
      </DialogFooter>
    </ModalRoot>
  );
}

export function openReleaseNotes(markdown: string, source: NotesSource) {
  showModal(<ReleaseNotesModal markdown={markdown} source={source} />);
}
