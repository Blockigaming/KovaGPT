import { createFileRoute } from "@tanstack/react-router";
import { ASSISTANTS } from "@/content/directories";
import { PublicPageTemplate } from "@/components/PublicPageTemplate";
import { publicPageHead } from "@/lib/public-page-head";
const page = {
  path: "/assistants",
  title: "KovaGPT assistants",
  description: "Focused KovaGPT assistants for useful workflows.",
  family: "assistants",
  eyebrow: "Directory",
  summary: "Choose a focused starting point; every assistant still requires your review.",
  sections: ASSISTANTS.map((a) => ({ heading: a.name, body: a.summary })),
  cta: { label: "Start a chat", href: "/" },
};
export const Route = createFileRoute("/assistants")({
  head: ({ matches }) => (matches.at(-1)?.pathname === "/assistants" ? publicPageHead(page) : {}),
  component: () => <PublicPageTemplate page={page} />,
});
