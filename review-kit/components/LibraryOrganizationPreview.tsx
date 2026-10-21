import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
const samples = [
  { id: "brief", name: "Product research and planning notes.txt", folder: "Projects" },
  { id: "image", name: "Sample landscape.png", folder: "Images" },
];
export function LibraryOrganizationPreview() {
  const errorId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [items, setItems] = useState(samples);
  const [selected, setSelected] = useState<string | null>(null);
  const [action, setAction] = useState<"rename" | "move" | "delete">("rename");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [fail, setFail] = useState(false);
  const [notice, setNotice] = useState("");
  const [removed, setRemoved] = useState<(typeof samples)[number] | null>(null);
  const item = items.find((i) => i.id === selected);
  return (
    <section className="space-y-4">
      <div>
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold">
          Library organization
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Proposed item-renaming interface · local sample files only. Production item renaming is
          unavailable; no file is uploaded or changed.
        </p>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={fail} onChange={(e) => setFail(e.target.checked)} />
        Simulate save failure
      </label>
      <ul className="space-y-3">
        {items.map((i) => (
          <li
            key={i.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4"
          >
            <div className="min-w-0">
              <p className="break-words font-medium">{i.name}</p>
              <p className="text-sm text-muted-foreground">{i.folder} · sample content</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(["rename", "move", "delete"] as const).map((a) => (
                <Button
                  key={a}
                  variant="outline"
                  aria-label={`${a[0].toUpperCase() + a.slice(1)} ${i.name}`}
                  onClick={(event) => {
                    triggerRef.current = event.currentTarget;
                    setSelected(i.id);
                    setAction(a);
                    setDraft(a === "move" ? i.folder : i.name);
                    setError("");
                  }}
                >
                  {a[0].toUpperCase() + a.slice(1)}
                </Button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {!items.length && (
        <p className="rounded-2xl border p-6 text-muted-foreground">
          No sample files remain. Reset sample to restore them.
        </p>
      )}
      <p role="status" className="text-sm">
        {notice}
      </p>
      {removed && (
        <Button
          ref={undoRef}
          variant="outline"
          onClick={() => {
            setItems((v) => [...v, removed]);
            setRemoved(null);
            setNotice("Sample deletion undone.");
            headingRef.current?.focus();
          }}
        >
          Undo sample deletion
        </Button>
      )}
      <Dialog
        open={!!item}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = triggerRef.current?.isConnected
              ? triggerRef.current
              : (undoRef.current ?? headingRef.current);
            target?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {action === "delete"
                ? "Delete sample file?"
                : action === "move"
                  ? "Move sample file"
                  : "Rename sample file"}
            </DialogTitle>
            <DialogDescription>
              {item?.name}. This changes local review data only.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!item) return;
              if (action !== "delete" && !draft.trim()) {
                setError("Enter a name.");
                return;
              }
              if (fail) {
                setError(
                  "Sample save failed. Your changes are kept; turn off simulated failure and retry.",
                );
                return;
              }
              if (action === "delete") {
                setItems((v) => v.filter((i) => i.id !== item.id));
                setRemoved(item);
              } else
                setItems((v) =>
                  v.map((i) =>
                    i.id === item.id
                      ? { ...i, [action === "move" ? "folder" : "name"]: draft.trim() }
                      : i,
                  ),
                );
              setNotice(`Sample ${action} completed.`);
              setSelected(null);
            }}
          >
            {action === "rename" && (
              <label className="block space-y-2 text-sm">
                File name
                <Input
                  value={draft}
                  aria-describedby={error ? errorId : undefined}
                  maxLength={180}
                  onChange={(e) => setDraft(e.target.value)}
                  autoFocus
                />
              </label>
            )}
            {action === "move" && (
              <label className="block space-y-2 text-sm">
                Destination
                <select
                  className="min-h-11 w-full rounded-xl border bg-background px-3"
                  value={draft}
                  aria-describedby={error ? errorId : undefined}
                  onChange={(e) => setDraft(e.target.value)}
                >
                  {["Projects", "Images", "Library"].map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={fail}
                onChange={(event) => setFail(event.target.checked)}
              />
              Simulate save failure for this action
            </label>
            {error && (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit">{action === "delete" ? "Delete sample" : "Save sample"}</Button>
              <Button type="button" variant="outline" onClick={() => setSelected(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
