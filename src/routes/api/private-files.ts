import { createFileRoute } from "@tanstack/react-router";
import { handleOwnedPrivateDownload } from "@/lib/kova-auth-private-download.server";

export const Route = createFileRoute("/api/private-files")({
  server: { handlers: { GET: ({ request }) => handleOwnedPrivateDownload(request) } },
});
