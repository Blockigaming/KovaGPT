import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { readResponseBytesBounded } from "@/lib/endpoint-reliability.mjs";
import {
  LIBRARY_ORIGINAL_MAX_BYTES,
  ORIGINAL_DOCUMENT_MIMES,
} from "@/lib/library-original-policy.mjs";
export async function originalLibraryHeaders(owner: string, signal: AbortSignal) {
  const result = await new Promise<Awaited<ReturnType<typeof supabase.auth.getSession>>>(
    (resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      void supabase.auth
        .getSession()
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", abort));
    },
  );
  const session = result.data.session;
  signal.throwIfAborted();
  if (!session?.access_token || session.user.id !== owner)
    throw new Error("Your account changed. Please try again.");
  return { Authorization: `Bearer ${session.access_token}`, "X-Kova-Owner": owner };
}
async function errorMessage(response: Response, signal: AbortSignal) {
  const bytes = await readResponseBytesBounded(response, 16384, { signal, timeoutMs: 5000 });
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    return typeof value.error === "string" ? value.error : "The original file request failed.";
  } catch {
    return "The original file request failed.";
  }
}
export async function saveOriginalLibraryFile(
  owner: string,
  id: string,
  file: File,
  text: string,
  signal: AbortSignal,
  expectedGeneration?: string,
) {
  const current = AbortSignal.any([signal, AbortSignal.timeout(50_000)]);
  if (file.size < 8 || file.size > LIBRARY_ORIGINAL_MAX_BYTES)
    throw new Error("Original files must be 10 MB or smaller.");
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "",
    mime = ORIGINAL_DOCUMENT_MIMES[extension];
  if (!mime) throw new Error("This original file format is unsupported.");
  const form = new FormData();
  form.set("file", new Blob([file], { type: mime }), file.name);
  form.set("text", text);
  const response = await fetch(
    `/api/library/files?id=${encodeURIComponent(id)}${expectedGeneration ? `&generation=${encodeURIComponent(expectedGeneration)}` : ""}`,
    {
      method: "POST",
      headers: await originalLibraryHeaders(owner, current),
      body: form,
      signal: current,
      credentials: "omit",
      cache: "no-store",
    },
  );
  if (!response.ok) throw new Error(await errorMessage(response, current));
  const bytes = await readResponseBytesBounded(response, 16384, {
    signal: current,
    timeoutMs: 5000,
  });
  const result = JSON.parse(new TextDecoder().decode(bytes));
  if (result.id !== id || typeof result.generation !== "string")
    throw new Error("Original file save could not be confirmed. Please retry.");
  return result as { id: string; generation: string };
}
export async function readOriginalLibraryFile(
  owner: string,
  id: string,
  generation: string,
  signal: AbortSignal,
) {
  const current = AbortSignal.any([signal, AbortSignal.timeout(50_000)]);
  const response = await fetch(
    `/api/library/files?id=${encodeURIComponent(id)}&generation=${encodeURIComponent(generation)}`,
    {
      headers: await originalLibraryHeaders(owner, current),
      signal: current,
      credentials: "omit",
      cache: "no-store",
    },
  );
  if (!response.ok) throw new Error(await errorMessage(response, current));
  const contentType = response.headers.get("content-type")?.split(";", 1)[0] ?? "";
  if (!Object.values(ORIGINAL_DOCUMENT_MIMES).includes(contentType))
    throw new Error("The original file response was invalid.");
  const bytes = await readResponseBytesBounded(response, LIBRARY_ORIGINAL_MAX_BYTES, {
    signal: current,
    timeoutMs: 15000,
  });
  return new Blob([bytes as BlobPart], { type: contentType });
}

export async function saveOriginalLibraryAttachment(
  file: File,
  attachment: { clientId?: string; textContent?: string },
  scope: { principal: string | null },
  isCurrent: () => boolean,
  active: Set<AbortController>,
) {
  if (!isCurrent() || !scope.principal || !attachment.clientId) return;
  const controller = new AbortController();
  active.add(controller);
  try {
    await saveOriginalLibraryFile(
      scope.principal,
      attachment.clientId,
      file,
      attachment.textContent ?? "",
      controller.signal,
    );
    if (isCurrent() && !controller.signal.aborted)
      toast.success(`${file.name} saved to Library. Chat uses its extracted text.`);
  } finally {
    active.delete(controller);
  }
}
