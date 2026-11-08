import { toast } from "sonner";
import { safeBrowserStorage } from "./principal-browser-storage.mjs";
import { chatStoragePrincipal } from "./chat-store";

type Intent = { id: string; deadline: number };
type Pending = {
  promise: Promise<boolean>;
  undo(): void;
  cancel(): void;
  current: () => boolean;
  commit: () => Promise<boolean>;
};
const pending = new Map<string, Pending>();
const listeners = new Set<() => void>();
const key = (owner: string | null) => `kova-chat-delete-intents-v1:${chatStoragePrincipal(owner)}`;
const identity = (owner: string | null, id: string) => JSON.stringify([owner, id]);
export function readChatDeleteIntents(owner: string | null): Intent[] {
  try {
    const data = JSON.parse(safeBrowserStorage("localStorage")?.getItem(key(owner)) || "[]");
    return Array.isArray(data)
      ? data
          .filter(
            (x): x is Intent =>
              typeof x?.id === "string" &&
              x.id.length > 0 &&
              x.id.length <= 200 &&
              Number.isFinite(x.deadline),
          )
          .slice(0, 100)
      : [];
  } catch {
    return [];
  }
}
function store(owner: string | null, intents: Intent[]) {
  const storage = safeBrowserStorage("localStorage");
  if (!storage) throw new Error("Chat deletion could not be saved.");
  // Only an ID and deadline are retained here, never a recoverable chat copy.
  storage.setItem(key(owner), JSON.stringify(intents));
  for (const listener of listeners) listener();
}
export function subscribeChatDeleteIntents(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function deleteChatWithUndo(
  owner: string | null,
  id: string,
  current: () => boolean,
  commit: () => Promise<boolean>,
  deadline = Date.now() + 5000,
): Promise<boolean> {
  const token = identity(owner, id);
  const existing = pending.get(token);
  const intents = readChatDeleteIntents(owner);
  if (existing && intents.some((item) => item.id === id)) {
    existing.current = current;
    existing.commit = commit;
    return existing.promise;
  }
  if (existing) existing.cancel();
  const persisted = intents.find((item) => item.id === id);
  deadline = persisted?.deadline ?? deadline;
  if (!persisted) store(owner, [...intents, { id, deadline }]);
  let settle!: (value: boolean) => void;
  let reject!: (error: unknown) => void;
  let committing = false;
  let done = false;
  const promise = new Promise<boolean>((resolve, fail) => {
    settle = resolve;
    reject = fail;
  });
  let toastId: string | number | undefined;
  const remove = () =>
    store(
      owner,
      readChatDeleteIntents(owner).filter((item) => item.id !== id),
    );
  const finish = () => {
    done = true;
    if (pending.get(token) === entry) pending.delete(token);
    if (toastId !== undefined) toast.dismiss(toastId);
  };
  const entry: Pending = {
    promise,
    cancel: () => {
      if (done || committing) return;
      clearTimeout(timer);
      finish();
      settle(false);
    },
    current,
    commit,
    undo: () => {
      if (done || committing || Date.now() >= deadline || !entry.current()) return;
      clearTimeout(timer);
      try {
        remove();
        finish();
        settle(false);
      } catch (error) {
        finish();
        reject(error);
      }
    },
  };
  pending.set(token, entry);
  const timer = setTimeout(
    async () => {
      if (done) return;
      if (
        !readChatDeleteIntents(owner).some((item) => item.id === id && item.deadline === deadline)
      ) {
        finish();
        settle(false);
        return;
      }
      if (!entry.current()) {
        finish();
        settle(false);
        return;
      } // Retain intent until the original account resumes.
      committing = true;
      try {
        const deleted = await entry.commit();
        if (deleted) remove();
        finish();
        settle(deleted);
      } catch (error) {
        // A failed save is not a deletion. Keep the original chat and let the user retry.
        try {
          remove();
        } catch {
          /* Original data remains intact. */
        }
        finish();
        reject(error);
      }
    },
    Math.max(0, deadline - Date.now()),
  );
  const remaining = deadline - Date.now();
  if (remaining > 0)
    toastId = toast.success("Chat deleted", {
      description: "Undo within 5 seconds before permanent deletion.",
      duration: remaining,
      action: { label: "Undo", onClick: entry.undo },
    });
  return promise;
}
