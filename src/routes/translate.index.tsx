import { createFileRoute } from "@tanstack/react-router";
import { TranslationWorkspace } from "@/components/translation/TranslationWorkspace";

export const Route = createFileRoute("/translate/")({
  component: TranslateIndex,
  head: () => ({
    meta: [
      { title: "Kova Translate | Fast, natural translation" },
      {
        name: "description",
        content: "Translate text while preserving meaning, tone, and intent with Kova.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function TranslateIndex() {
  return <TranslationWorkspace />;
}
