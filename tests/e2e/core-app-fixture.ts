import type { Page } from "@playwright/test";
import { fixture, functionNames, owner } from "./actual-app-fixture";

export const reviewProject = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Review project",
  description: "Synthetic project for local interface review.",
  system_prompt: "Keep project answers concise and cite the supplied material.",
  color: null,
  owner_id: owner,
  role: "owner",
  member_count: 1,
  chat_count: 0,
  file_count: 0,
  pinned_at: null,
  archived_at: null,
  deletion_requested_at: null,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-16T10:00:00Z",
};
export const reviewItems = [
  "Release notes",
  "Long filename that wraps naturally on a small phone screen",
].map((title, i) => ({
  id: `${i + 4}4444444-4444-4444-8444-444444444444`,
  user_id: owner,
  title,
  item_type: "document",
  source: "manual",
  content_text: "Synthetic review content. No account records are included.",
  content_excerpt: "Synthetic review content.",
  content_generation: `${i + 6}6666666-6666-4666-8666-666666666666`,
  content_revision: 1,
  file_name: "Notes.txt",
  file_type: "text/plain",
  file_url: null,
  file_size: 1234,
  folder_id: null,
  metadata: {},
  created_at: "2026-10-16T10:00:00Z",
}));

// Browser test/review fixture only. No production flag, account selector,
// provider request or successful mutation is introduced by this module.
export async function coreFixture(
  page: Page,
  theme: "light" | "dark" = "light",
  tier: "free" | "plus" | "pro" = "free",
) {
  await fixture(page, theme, true, true, tier);
  // Use a defined returning-user sidebar preference before hydration.
  await page.addInitScript(() => localStorage.setItem("kova-sidebar-open", "0"));
  await page.route("**/_serverFn/**", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    const name = (functionNames.get(id) ?? "").split("_")[0];
    const reads: Record<string, unknown> = {
      listProjects: [reviewProject],
      getProject: reviewProject,
      listMembers: [
        {
          user_id: owner,
          email: "review@example.invalid",
          role: "owner",
          created_at: reviewProject.created_at,
        },
      ],
      getGitHubManagement: {
        configured: false,
        accounts: [],
        installations: [],
        repositories: [],
        health: "credentials_not_configured",
      },
      isScheduledTasksEligible: { eligible: true, executionAvailable: false },
      listScheduledTaskOffers: { sent: [], received: [] },
      getMyDailyUsage: { chats: 3, images: 0, uploads: 0, resetsAt: "2026-10-17T00:00:00Z" },
      getSubscriptionSummary: {
        effectiveTier: tier,
        tier,
        hasBillingAccount: false,
        billingPortalAvailable: false,
        activeSubscriptionCount: 0,
      },
      getChatCustomRules: { instructions: "", enabled: false },
    };
    if (name in reads) return route.fulfill({ json: { result: reads[name], context: {} } });
    if (/^(list|search)/.test(name)) return route.fulfill({ json: { result: [], context: {} } });
    return route.fulfill({
      status: 503,
      json: { error: "This service is not connected in the local review." },
    });
  });
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/google/status")
      return route.fulfill({
        json: {
          connected: false,
          configured: false,
          state: "disconnected",
          accounts: [],
          selectionRevision: 0,
          selectedConnectionId: null,
        },
      });
    if (path === "/api/discovery") return route.fulfill({ json: { enabled: false } });
    if (path === "/api/library/folders") return route.fulfill({ json: { folders: [] } });
    if (path === "/api/library/items") {
      if (route.request().method() === "GET") {
        const item = reviewItems.find((item) => item.id === url.searchParams.get("id"));
        return route.fulfill({
          status: item ? 200 : 404,
          json: item ?? { error: "Review item not found." },
        });
      }
      const data = route.request().postDataJSON();
      if (data?.operation === "list")
        return route.fulfill({
          json: {
            items: reviewItems.filter((item) =>
              item.title.toLowerCase().includes(String(data.query ?? "").toLowerCase()),
            ),
            cursor: null,
            hasMore: false,
          },
        });
    }
    return route.fulfill({
      status: 503,
      json: { error: "This service is not connected in the local review." },
    });
  });
}
