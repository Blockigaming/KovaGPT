import { createFileRoute } from "@tanstack/react-router";
import { activityHostname } from "@/lib/activity-display.mjs";
// Fetch only a public favicon from one fixed provider. User-controlled hosts
// never become a network destination; authenticated browser cookies are omitted.
export const Route = createFileRoute("/api/activity-icon")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const input = new URL(request.url).searchParams.get("host");
        const host = activityHostname(input);
        if (!host || host !== input) return new Response(null, { status: 400 });
        try {
          const result = await fetch(
            `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`,
            { signal: AbortSignal.timeout(4000), redirect: "error", credentials: "omit" },
          );
          const contentType = result.headers.get("content-type")?.split(";", 1)[0] ?? "";
          if (
            !result.ok ||
            ![
              "image/png",
              "image/x-icon",
              "image/vnd.microsoft.icon",
              "image/jpeg",
              "image/webp",
            ].includes(contentType)
          ) {
            void result.body?.cancel();
            return new Response(null, { status: 404 });
          }
          const reader = result.body?.getReader();
          if (!reader) return new Response(null, { status: 404 });
          let size = 0;
          const chunks: Uint8Array[] = [];
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 65536) {
              void reader.cancel();
              return new Response(null, { status: 404 });
            }
            chunks.push(value);
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          return new Response(bytes, {
            headers: {
              "Content-Type": contentType,
              "Cache-Control": "public, max-age=86400",
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch {
          return new Response(null, { status: 404 });
        }
      },
    },
  },
});
