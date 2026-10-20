import { supabase } from "@/integrations/supabase/client";
import { readResponseBytesBounded } from "@/lib/endpoint-reliability.mjs";
import {
  ACCOUNT_EMAIL_EVENTS,
  parseAccountEmailPreferences,
} from "@/lib/account-email-preferences.mjs";

export type AccountEmailEvent = (typeof ACCOUNT_EMAIL_EVENTS)[number]["key"];
export type AccountEmailPreferences = Record<AccountEmailEvent, boolean>;

/** Bind every request to the account whose settings are currently displayed. */
export async function requestAccountEmailPreferences(
  ownerId: string,
  signal: AbortSignal,
  patch?: Partial<AccountEmailPreferences>,
): Promise<AccountEmailPreferences> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  deadline.throwIfAborted();
  const session = await new Promise<Awaited<ReturnType<typeof supabase.auth.getSession>>>(
    (resolve, reject) => {
      const abort = () => reject(new Error("Email settings request canceled."));
      deadline.addEventListener("abort", abort, { once: true });
      Promise.resolve(supabase.auth.getSession())
        .then(resolve, reject)
        .finally(() => deadline.removeEventListener("abort", abort));
      if (deadline.aborted) abort();
    },
  );
  deadline.throwIfAborted();
  if (
    session.error ||
    session.data.session?.user.id !== ownerId ||
    !session.data.session.access_token
  ) {
    throw new Error("Your account changed. Reload email settings.");
  }
  const response = await fetch("/api/account/email-preferences", {
    method: patch ? "PATCH" : "GET",
    credentials: "same-origin",
    mode: "same-origin",
    redirect: "error",
    cache: "no-store",
    signal: deadline,
    headers: {
      Authorization: `Bearer ${session.data.session.access_token}`,
      "X-Kova-Owner": ownerId,
      ...(patch ? { "Content-Type": "application/json" } : {}),
    },
    ...(patch ? { body: JSON.stringify({ preferences: patch }) } : {}),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      response.status === 401 || response.status === 409
        ? "Your account changed. Reload email settings."
        : response.status === 429
          ? "Too many changes. Wait a moment, then reload email settings."
          : "Email settings are unavailable. Reload to check their current state.",
    );
  }
  const text = new TextDecoder().decode(
    await readResponseBytesBounded(response, 4096, { signal: deadline, timeoutMs: 5_000 }),
  );
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Email settings returned an invalid response.");
  }
  const preferences = parseAccountEmailPreferences(value?.preferences);
  if (value?.version !== 1 || !preferences) {
    throw new Error("Email settings returned an invalid response.");
  }
  return preferences;
}
