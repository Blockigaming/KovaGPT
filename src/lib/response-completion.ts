import { extractResponseFiles } from "@/lib/response-files.mjs";
import { fileResultDescriptor } from "@/lib/response-file-result";

/** Result-pane descriptor for the last complete file in a finished reply, if any. */
export function latestFileResult(message: { id: string; content: string }) {
  const file = extractResponseFiles(message.content)
    .filter((candidate) => candidate.complete)
    .at(-1);
  return file ? fileResultDescriptor(message.id, file) : null;
}

/** A reply that finished in a background tab notifies only if the user already allowed it. */
export function notifyResponseReady(messageId: string) {
  try {
    if (Notification.permission === "granted")
      new Notification("KovaGPT", { body: "Your response is ready.", tag: messageId });
  } catch {
    /* Notifications are unavailable on this device. */
  }
}
