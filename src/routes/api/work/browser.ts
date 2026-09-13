import { createFileRoute } from "@tanstack/react-router";
import { requireVerifiedUser } from "@/lib/api-auth.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { commandWorkBrowser, listWorkBrowsers } from "@/lib/work-browser.server";
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
export async function handleWorkBrowser(request: Request) {
  if (request.method === "POST" && isCrossSiteMutation(request))
    return json({ error: "cross_site_request_blocked" }, 403);
  const caller = await requireVerifiedUser(request);
  if (caller instanceof Response) return caller;
  const url = new URL(request.url);
  if (request.method === "GET" && url.searchParams.get("expectedUserId") !== caller.userId)
    return json({ error: "work_browser_owner_conflict" }, 409);
  const rate = await consumeApplicationRateLimit({
    identity: `user:${caller.userId}`,
    action: "work_browser_control",
    limit: 120,
    windowSeconds: 60,
  });
  if (!rate.allowed)
    return json({ error: "work_browser_rate_limited" }, rate.status === "limited" ? 429 : 503);
  try {
    if (request.method === "GET")
      return json(await listWorkBrowsers(caller, url.searchParams.get("runId") ?? ""));
    if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json")
      return json({ error: "json_content_type_required" }, 415);
    return json(
      await commandWorkBrowser(caller, await readBoundedJsonObject(request, 12000), request.signal),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return json(
      { error: "work_browser_action_unconfirmed" },
      /conflict/.test(message)
        ? 409
        : /invalid/.test(message)
          ? 400
          : /denied|required/.test(message)
            ? 403
            : 503,
    );
  }
}
export const Route = createFileRoute("/api/work/browser")({
  server: {
    handlers: {
      GET: ({ request }) => handleWorkBrowser(request),
      POST: ({ request }) => handleWorkBrowser(request),
    },
  },
});
