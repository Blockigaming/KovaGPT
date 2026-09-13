import { supabase } from "@/integrations/supabase/client";
import { readResponseBytesBounded } from "@/lib/endpoint-reliability.mjs";

export async function imageApiRequest(
  ownerId: string,
  path: string,
  signal: AbortSignal,
  body?: unknown,
) {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(50_000)]);
  const sessionResult = await new Promise<Awaited<ReturnType<typeof supabase.auth.getSession>>>(
    (resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      if (requestSignal.aborted) {
        abort();
        return;
      }
      requestSignal.addEventListener("abort", abort, { once: true });
      void supabase.auth
        .getSession()
        .then(resolve, reject)
        .finally(() => requestSignal.removeEventListener("abort", abort));
    },
  );
  const session = sessionResult.data.session;
  if (requestSignal.aborted || session?.user.id !== ownerId || !session.access_token)
    throw new Error("Your account changed. Please try again.");
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    signal: requestSignal,
    credentials: "omit",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json"))
    throw new Error("The image service returned an invalid response.");
  const bytes = await readResponseBytesBounded(
    response,
    body === undefined ? 64 * 1024 : 12 * 1024 * 1024,
    { signal: requestSignal, timeoutMs: 10000 },
  );
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
  } catch {
    throw new Error("The image service returned an invalid response.");
  }
  return { response, body: value };
}
