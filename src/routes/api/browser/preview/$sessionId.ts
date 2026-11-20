import { createFileRoute } from "@tanstack/react-router";
import { requireVerifiedUser } from "@/lib/api-auth.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { ChatPreflightError } from "@/lib/chat-preflight.server.mjs";
import { controlChatBrowser, readChatBrowserPreview } from "@/lib/chat-browser.server";
import { cloudBrowserId, parseCloudBrowserControl } from "@/lib/cloud-browser-control";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const notFound = () => new Response(null, { status: 404, headers });

export const Route = createFileRoute("/api/browser/preview/$sessionId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const caller = await requireVerifiedUser(request);
        if (caller instanceof Response) return caller;
        if (
          request.headers.get("x-kova-owner") !== caller.userId ||
          !cloudBrowserId.test(params.sessionId)
        )
          return notFound();
        const preview = await readChatBrowserPreview(caller, params.sessionId);
        if (!preview) return notFound();
        return new Response(Uint8Array.from(Buffer.from(preview, "base64")), {
          headers: { ...headers, "Content-Type": "image/jpeg" },
        });
      },
      POST: async ({ request, params }) => {
        if (isCrossSiteMutation(request)) return new Response(null, { status: 403, headers });
        const caller = await requireVerifiedUser(request);
        if (caller instanceof Response) return caller;
        if (
          request.headers.get("x-kova-owner") !== caller.userId ||
          !cloudBrowserId.test(params.sessionId)
        )
          return notFound();
        let action;
        try {
          action = parseCloudBrowserControl(await readBoundedJsonObject(request, 5000));
        } catch {
          return new Response(null, { status: 400, headers });
        }
        if (!action) return new Response(null, { status: 400, headers });
        try {
          const frame = await controlChatBrowser(caller, params.sessionId, action);
          return Response.json({ frame }, { headers });
        } catch (error) {
          const detail = error instanceof ChatPreflightError ? error : null;
          return Response.json(
            {
              message:
                detail?.toEnvelope().error ?? "Cloud Browser could not complete that action.",
            },
            { status: detail?.status ?? 503, headers },
          );
        }
      },
    },
  },
});
