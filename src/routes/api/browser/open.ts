import { createFileRoute } from "@tanstack/react-router";
import { assertNotBanned, getCallerTier, requireVerifiedUser } from "@/lib/api-auth.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { openManualChatBrowser } from "@/lib/chat-browser.server";
import { chatBrowserDestination } from "@/lib/chat-browser-policy.mjs";
import { ChatPreflightError } from "@/lib/chat-preflight.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { readLockdownMode } from "@/lib/lockdown-policy.mjs";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function handleManualBrowserOpen(request: Request) {
  if (isCrossSiteMutation(request)) return json({ error: "Request is not allowed." }, 403);
  const caller = await requireVerifiedUser(request);
  if (caller instanceof Response) return caller;
  if (request.headers.get("x-kova-owner") !== caller.userId)
    return json({ error: "Your account has changed. Open Cloud Browser again." }, 409);
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json")
    return json({ error: "Expected a JSON request." }, 415);

  let body;
  try {
    body = await readBoundedJsonObject(request, 5000);
  } catch {
    return json({ error: "Include one public HTTPS link for Cloud Browser to open." }, 400);
  }
  const url =
    Object.keys(body).length === 1 && typeof body.url === "string"
      ? chatBrowserDestination(body.url)
      : null;
  if (!url) return json({ error: "Include one public HTTPS link for Cloud Browser to open." }, 400);

  try {
    const rate = await consumeApplicationRateLimit({
      identity: `user:${caller.userId}`,
      action: "cloud_browser_manual_open",
      limit: 8,
      windowSeconds: 60,
    });
    if (!rate.allowed)
      return json(
        { error: "Cloud Browser is busy. Try again shortly." },
        rate.status === "limited" ? 429 : 503,
      );
    const banned = await assertNotBanned(caller);
    if (banned) return banned;
    if (await readLockdownMode(caller.supabaseAdmin, caller.userId))
      return json({ error: "Cloud Browser is unavailable with your account settings." }, 403);
    const tier = await getCallerTier(caller);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(22_000)]);
    return json(await openManualChatBrowser({ caller, tier, url, signal }));
  } catch (error) {
    return error instanceof ChatPreflightError
      ? json(error.toEnvelope(), error.status)
      : json({ error: "Cloud Browser is temporarily unavailable. Try again shortly." }, 503);
  }
}

export const Route = createFileRoute("/api/browser/open")({
  server: { handlers: { POST: ({ request }) => handleManualBrowserOpen(request) } },
});
