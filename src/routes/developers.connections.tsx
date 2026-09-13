import { createFileRoute } from "@tanstack/react-router";
import { DeveloperMcpAccessPage } from "@/components/DeveloperMcpAccess";
export const Route = createFileRoute("/developers/connections")({
  ssr: false,
  component: () => <DeveloperMcpAccessPage />,
  head: () => ({
    meta: [
      { title: "MCP connections | KovaGPT" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});
