import { createFileRoute } from "@tanstack/react-router";
import { DeveloperMcpAccessPage } from "@/components/DeveloperMcpAccess";
export const Route = createFileRoute("/developers/authorize")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    request_id: typeof search.request_id === "string" ? search.request_id.slice(0, 36) : "",
  }),
  component: DeveloperAuthorizeRoute,
  head: () => ({
    meta: [
      { title: "Authorize developer MCP | KovaGPT" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
});

function DeveloperAuthorizeRoute() {
  const { request_id } = Route.useSearch();
  return request_id ? (
    <DeveloperMcpAccessPage requestId={request_id} />
  ) : (
    <p>Invalid authorization request. Restart from your client.</p>
  );
}
