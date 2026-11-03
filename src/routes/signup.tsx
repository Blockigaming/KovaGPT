import { createFileRoute } from "@tanstack/react-router";
import { PublicLogin } from "@/components/public/PublicLogin";
export const Route = createFileRoute("/signup")({
  component: () => <PublicLogin mode="sign-up" />,
  head: () => ({
    meta: [
      { title: "Create an account | KovaGPT" },
      { name: "robots", content: "noindex, follow" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/signup" }],
  }),
});
