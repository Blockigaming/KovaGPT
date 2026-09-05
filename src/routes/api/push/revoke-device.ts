import { createFileRoute } from "@tanstack/react-router";
import { rejectCrossSiteRequest } from "@/lib/http-security.server";
import { readResponseBytesBounded } from "@/lib/endpoint-reliability.mjs";
import { revokePushDevice } from "@/lib/pwa/push.server";
export const Route = createFileRoute("/api/push/revoke-device")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const csrf = rejectCrossSiteRequest(request);
        if (csrf) return csrf;
        const headers = { "Cache-Control": "no-store" };
        try {
          const raw = await readResponseBytesBounded(request, 1024, {
              signal: request.signal,
              timeoutMs: 2000,
            }),
            data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
          if (
            !/^[a-f0-9-]{36}$/iu.test(data?.id ?? "") ||
            !/^[A-Za-z0-9_-]{43}$/u.test(data?.deviceSecret ?? "")
          )
            return Response.json({ error: "invalid_request" }, { status: 400, headers });
          await revokePushDevice(data.id, data.deviceSecret);
          return Response.json({ ok: true }, { headers });
        } catch {
          return Response.json({ error: "revoke_unavailable" }, { status: 503, headers });
        }
      },
    },
  },
});
