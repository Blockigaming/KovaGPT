import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { timingSafeEqualText } from "@/lib/http-security.server";
import { readUtf8BodyBounded } from "@/lib/endpoint-reliability.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { workRunnerConfiguration } from "@/lib/work-runner.server";
import { verifyBrowserInvocation } from "@/lib/work-browser-transport.mjs";
import { signRunnerEnvelope } from "@/lib/work-runner-transport.mjs";
import { WORK_EXECUTION_PROTOCOL } from "@/lib/work-execution-protocol.mjs";
import { authorizeWorkBrowser } from "@/lib/work-browser.server";
export async function handleBrowserAuthority(request: Request) {
  const reject = (status = 403) =>
    Response.json(
      { error: "work_browser_authority_denied" },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  try {
    const config = workRunnerConfiguration();
    if (!config) return reject(503);
    const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!token || !timingSafeEqualText(token, config.token)) return reject(401);
    const invocation = await verifyBrowserInvocation(
      config,
      await readUtf8BodyBounded(request, 4096),
      request.headers.get("x-kova-signature"),
    );
    const rate = await consumeApplicationRateLimit({
      identity: `browser-runner:${config.id}`,
      action: "work_browser_authority",
      limit: 1200,
      windowSeconds: 60,
    });
    if (!rate.allowed) return reject(rate.status === "limited" ? 429 : 503);
    const owner = await supabaseAdmin.auth.admin.getUserById(invocation.payload.ownerId);
    const user = owner.data?.user as {
      id: string;
      email_confirmed_at?: string;
      banned_until?: string;
      deleted_at?: string;
    } | null;
    if (
      owner.error ||
      !user ||
      !user.email_confirmed_at ||
      user.deleted_at ||
      (user.banned_until && Date.parse(user.banned_until) > Date.now())
    )
      return reject();
    const url = runtimeEnv("SUPABASE_URL"),
      key = runtimeEnv("SUPABASE_PUBLISHABLE_KEY");
    if (!url || !key) return reject(503);
    const payload = await authorizeWorkBrowser(
      {
        userId: user.id,
        emailVerified: true,
        supabaseAdmin,
        supabaseUser: createClient<Database>(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        }),
      },
      invocation.payload,
    );
    const raw = JSON.stringify({
      protocol: WORK_EXECUTION_PROTOCOL,
      runnerId: config.id,
      build: config.build,
      requestId: invocation.requestId,
      at: Date.now(),
      payload,
    });
    return new Response(raw, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Kova-Signature": await signRunnerEnvelope(config.signingKey, "response", raw),
      },
    });
  } catch {
    return reject();
  }
}
export const Route = createFileRoute("/api/internal/work-browser")({
  server: { handlers: { POST: ({ request }) => handleBrowserAuthority(request) } },
});
