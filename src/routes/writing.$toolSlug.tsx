import { createFileRoute, notFound } from "@tanstack/react-router";
import { WritingToolWorkspace } from "@/components/writing/WritingToolWorkspace";
import { getWritingTool } from "@/lib/writing-tool-catalog";

export const Route = createFileRoute("/writing/$toolSlug")({
  loader: ({ params }) => {
    const tool = getWritingTool(params.toolSlug);
    if (!tool) throw notFound();
    return { tool };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.tool.title ?? "Writing tool"} | KovaGPT` },
      {
        name: "description",
        content: loaderData?.tool.shortDescription ?? "A focused Kova writing tool.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: WritingToolPage,
});

function WritingToolPage() {
  const { tool } = Route.useLoaderData();
  return <WritingToolWorkspace tool={tool} />;
}
