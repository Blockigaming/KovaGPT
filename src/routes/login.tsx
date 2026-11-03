import { createFileRoute } from "@tanstack/react-router";
import { PublicLogin } from "@/components/public/PublicLogin";
export const Route = createFileRoute("/login")({
  component: () => <PublicLogin mode="sign-in" />,
  head: () => ({
    meta: [{ title: "Log in | KovaGPT" }, { name: "robots", content: "noindex, follow" }],
    links: [{ rel: "canonical", href: "https://kovagpt.com/login" }],
  }),
});
