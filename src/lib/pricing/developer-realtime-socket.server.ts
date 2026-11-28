import { developerRateError, developerRetryHeaders } from "./developer-http-errors.mjs";
import { defineWebSocketHandler } from "nitro";
import { enforceAzureProductionOriginBoundary } from "@/lib/origin-boundary.server";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { resolveAnonymousClientKey } from "@/lib/chat-ingress.server.mjs";
import {
  BROWSER_SOCKET_PATH,
  BROWSER_SOCKET_PROTOCOL,
  createDeveloperRealtimeSocket,
  developerRealtimeSessionsEnabled,
} from "./developer-realtime-session.server";
import {
  REALTIME_SOCKET_PATH,
  REALTIME_SOCKET_PROTOCOL,
  realtimeOrigin,
} from "./developer-realtime-session.mjs";

export function developerSocketHandler(kind: "realtime" | "browser" = "realtime") {
  const path = kind === "browser" ? BROWSER_SOCKET_PATH : REALTIME_SOCKET_PATH;
  const protocol = kind === "browser" ? BROWSER_SOCKET_PROTOCOL : REALTIME_SOCKET_PROTOCOL;
  const sockets = new Map<string, ReturnType<typeof createDeveloperRealtimeSocket>>();
  const MAX_LOCAL_CONNECTIONS = 32;
  const deny = (status: number) =>
    new Response(null, {
      status,
      headers: { "Cache-Control": "no-store", ...developerRetryHeaders(status) },
    });
  return defineWebSocketHandler({
    async upgrade(request) {
      try {
        // This Nitro route does not pass through the TanStack fetch middleware.
        // Enforce the same trusted-origin boundary before permitting an upgrade.
        const denied = enforceAzureProductionOriginBoundary(request as Request);
        if (denied) return denied;
        const url = new URL(request.url);
        if (
          url.pathname !== path ||
          url.search ||
          url.hash ||
          !developerRealtimeSessionsEnabled(kind)
        )
          return deny(404);
        realtimeOrigin(request.headers.get("origin"));
        if (request.headers.get("sec-websocket-protocol") !== protocol) return deny(400);
        if (sockets.size >= MAX_LOCAL_CONNECTIONS) return deny(503);
        const rate = await consumeApplicationRateLimit({
          identity: resolveAnonymousClientKey(request.headers),
          action: `developer_${kind}_socket_open`,
          limit: 20,
          windowSeconds: 60,
        });
        const error = developerRateError(rate);
        if (error) return deny(error.message === "developer_rate_limit" ? 429 : 503);
        return {
          headers: { "Sec-WebSocket-Protocol": protocol },
        };
      } catch {
        return deny(403);
      }
    },
    open(peer) {
      if (sockets.size >= MAX_LOCAL_CONNECTIONS || !peer.request) {
        peer.close(1013, "session_unavailable");
        return;
      }
      try {
        const socket = createDeveloperRealtimeSocket(
          peer.request.headers.get("origin"),
          {
            send: (event) => {
              const json = JSON.stringify(event);
              if (
                Buffer.byteLength(json) > 1400000 ||
                (peer.websocket.bufferedAmount ?? 0) > 2000000
              )
                throw Error("developer_realtime_backpressure");
              peer.send(json);
            },
            close: (code, reason) => {
              sockets.delete(peer.id);
              peer.close(code, reason);
            },
          },
          kind,
        );
        sockets.set(peer.id, socket);
      } catch {
        peer.close(1008, "session_unavailable");
      }
    },
    async message(peer, message) {
      const socket = sockets.get(peer.id);
      if (!socket) {
        peer.close(1008, "session_unavailable");
        return;
      }
      try {
        await socket.receive(message.text());
      } catch {
        await socket.stop(1011, "session_unavailable");
      }
    },
    async close(peer) {
      const socket = sockets.get(peer.id);
      sockets.delete(peer.id);
      await socket?.stop();
    },
    async error(peer) {
      const socket = sockets.get(peer.id);
      sockets.delete(peer.id);
      await socket?.stop(1011, "session_unavailable");
    },
  });
}
export default developerSocketHandler();
