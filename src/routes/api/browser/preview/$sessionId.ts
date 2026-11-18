import { createFileRoute } from "@tanstack/react-router";
import { requireVerifiedUser } from "@/lib/api-auth.server";
import { readChatBrowserPreview } from "@/lib/chat-browser.server";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export const Route = createFileRoute("/api/browser/preview/$sessionId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const caller = await requireVerifiedUser(request);
        if (caller instanceof Response) return caller;
        if (
          request.headers.get("x-kova-owner") !== caller.userId ||
          !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(params.sessionId)
        ) {
          return new Response(null, { status: 404, headers });
        }
        const preview = await readChatBrowserPreview(caller, params.sessionId);
        if (!preview) return new Response(null, { status: 404, headers });
        return new Response(Uint8Array.from(Buffer.from(preview, "base64")), {
          headers: { ...headers, "Content-Type": "image/jpeg" },
        });
      },
    },
  },
});
