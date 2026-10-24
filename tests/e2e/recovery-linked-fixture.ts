import type { Page } from "@playwright/test";
import { coreFixture, reviewItems } from "./core-app-fixture";
import { functionNames } from "./actual-app-fixture";

export const linkedPrompt = {
  id: "66666666-6666-4666-8666-666666666666",
  name: "Review briefing",
  category: "General",
  folder: "Unfiled",
  body: "Explain {{topic}} in three clear points.",
  variables: ["topic"],
  favorite: false,
  project_id: null,
  context_pack_id: null,
  last_used_at: null,
  created_at: "2026-10-16T10:00:00Z",
  updated_at: "2026-10-16T10:00:00Z",
  use_count: 0,
};
export const linkedReport = {
  id: "77777777-7777-4777-8777-777777777777",
  kova_id: "88888888-8888-4888-8888-888888888888",
  version_id: "99999999-9999-4999-8999-999999999999",
  name: "Synthetic moderation review",
  reason: "Synthetic report for local control review.",
  created_at: "2026-10-16T10:00:00Z",
  revision: 1,
  blocked: false,
  config: { instructions: "Synthetic published snapshot." },
  knowledge: [],
};

export async function linkedFixture(page: Page) {
  await coreFixture(page, "light", "plus");
  const saves: string[] = [];
  await page.route("**/_serverFn/**", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    const name = (functionNames.get(id) ?? "").split("_")[0];
    const reads: Record<string, unknown> = {
      listPromptTemplates: [linkedPrompt],
      listPromptHistory: { versions: [], evaluations: [] },
      listMyLibrary: reviewItems,
      listContextPacks: [],
      listKnowledgeGraph: {
        nodes: [
          {
            id: "file:review",
            kind: "file",
            label: "Review source",
            href: "/library",
            updatedAt: "2026-10-16T10:00:00Z",
          },
          {
            id: "context:review",
            kind: "context",
            label: "Review context",
            href: "/context-packs",
            updatedAt: "2026-10-15T10:00:00Z",
          },
        ],
        edges: [
          {
            source: "file:review",
            target: "context:review",
            strength: 2,
            reason: "Included in context pack",
          },
        ],
      },
    };
    if (name in reads) return route.fulfill({ json: { result: reads[name], context: {} } });
    if (name === "createContextPack") {
      saves.push(route.request().postData() ?? "");
      // This response exists only inside Playwright request interception.
      return route.fulfill({
        json: {
          result: {
            id: "local-review-pack",
            name: "Search-safe selection",
            description: "",
            items: [],
            created_at: "2026-10-17T00:00:00Z",
          },
          context: {},
        },
      });
    }
    return route.fallback();
  });
  await page.route("**/api/admin/kovas**", (route) => {
    if (route.request().method() !== "GET")
      return route.fulfill({ status: 503, json: { error: "Review mutations are unavailable." } });
    return new URL(route.request().url()).searchParams.has("id")
      ? route.fulfill({ status: 404, json: { error: "Synthetic lookup unavailable." } })
      : route.fulfill({ json: { rows: [linkedReport] } });
  });
  return { saves };
}
