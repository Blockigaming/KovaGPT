import { createFileRoute, notFound } from "@tanstack/react-router";
import { TranslationWorkspace } from "@/components/translation/TranslationWorkspace";
import { getTranslationPair } from "@/lib/translation-catalog";

export const Route = createFileRoute("/translate/$pairSlug")({
  loader: ({ params }) => {
    const pair = getTranslationPair(params.pairSlug);
    if (!pair) throw notFound();
    return { pair };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.pair
          ? `Translate ${loaderData.pair.source} to ${loaderData.pair.target} | KovaGPT`
          : "Kova Translate",
      },
      {
        name: "description",
        content: "Translate text while preserving meaning, tone, and intent with Kova.",
      },
    ],
  }),
  component: TranslationPairPage,
});

function TranslationPairPage() {
  const { pair } = Route.useLoaderData();
  return <TranslationWorkspace pair={pair} />;
}
