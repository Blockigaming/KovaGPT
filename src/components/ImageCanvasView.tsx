import { useId, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { chatImageFile, prepareChatComposer } from "@/lib/chat-image-actions";
import { conversationImages, subscribeConversationImages } from "@/lib/conversation-images";

/** A message carries at most two files, so a canvas selection is capped to match. */
const MAX_SELECTED = 2;
const EMPTY_LIST: never[] = [];

/**
 * Every image in this conversation side by side. Select up to two, write a note on each,
 * then send them to the message box for a follow-up edit.
 */
export function ImageCanvasView({ chat, current }: { chat: string; current: string }) {
  const images = useSyncExternalStore(
    subscribeConversationImages,
    () => conversationImages(chat),
    () => EMPTY_LIST,
  );
  const [selected, setSelected] = useState<string[]>([current]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const statusId = useId();
  const [principal, chatId] = JSON.parse(chat) as [string, string];
  const toggle = (src: string) =>
    setSelected((value) =>
      value.includes(src)
        ? value.filter((item) => item !== src)
        : value.length >= MAX_SELECTED
          ? value
          : [...value, src],
    );
  const send = async () => {
    if (!selected.length || busy) return;
    setBusy(true);
    try {
      const composer = prepareChatComposer(principal, chatId);
      const allowed = () => true;
      for (const src of selected) await composer.attach(await chatImageFile(src, allowed), allowed);
      const lines = selected
        .map((src, index) => ({ index, note: notes[src]?.trim() }))
        .filter((item) => item.note)
        .map((item) => `Image ${item.index + 1}: ${item.note}`);
      if (lines.length) composer.appendText(lines.join("\n"));
      toast.success(
        selected.length === 1
          ? "Image and note added to your message"
          : "Images and notes added to your message",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn’t add the images.");
    } finally {
      setBusy(false);
    }
  };
  const list = images;
  return (
    <div className="kova-image-canvas">
      <p id={statusId} className="text-sm text-muted-foreground" aria-live="polite">
        {list.length} {list.length === 1 ? "image" : "images"} in this chat · {selected.length} of{" "}
        {MAX_SELECTED} selected
      </p>
      <ul className="kova-image-canvas-grid" aria-describedby={statusId}>
        {list.map((image, index) => {
          const on = selected.includes(image.src);
          return (
            <li key={image.src} data-selected={on || undefined}>
              <label className="kova-image-canvas-pick">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!on && selected.length >= MAX_SELECTED}
                  onChange={() => toggle(image.src)}
                />
                <span className="sr-only">Select image {index + 1}</span>
                <img src={image.src} alt={image.alt || `Image ${index + 1}`} loading="lazy" />
              </label>
              {on && (
                <label className="kova-image-canvas-note">
                  <span className="sr-only">Note for image {index + 1}</span>
                  <textarea
                    rows={2}
                    maxLength={500}
                    placeholder="What should change?"
                    value={notes[image.src] ?? ""}
                    onChange={(event) =>
                      setNotes((value) => ({ ...value, [image.src]: event.target.value }))
                    }
                  />
                </label>
              )}
            </li>
          );
        })}
      </ul>
      <div className="kova-image-canvas-actions">
        <button type="button" disabled={!selected.length || busy} onClick={() => void send()}>
          {busy ? "Adding…" : `Add ${selected.length || ""} to message`.replace("  ", " ")}
        </button>
      </div>
    </div>
  );
}
