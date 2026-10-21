import type { Page } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { installAuthenticatedFixture } from "./authenticated-fixture";

export const origin = "http://127.0.0.1:4189";
export const owner = "22222222-2222-4222-8222-222222222222";
export const chatA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const chatB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const functionNames = new Map<string, string>();
const assets = ".nitro/vite/services/ssr/assets";
for (const file of readdirSync(assets).filter((name) => name.startsWith("vendor-tanstack"))) {
  const source = readFileSync(join(assets, file), "utf8");
  for (const match of source.matchAll(/"([a-f0-9]{64})":\s*\{\s*functionName: "([^"]+)"/g))
    functionNames.set(match[1], match[2]);
}

export async function fixture(
  page: Page,
  theme: "light" | "dark",
  signedIn = true,
  saved = false,
  tier: "free" | "plus" | "pro" = "free",
) {
  await page
    .context()
    .route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort("blockedbyclient"),
    );
  await page.context().routeWebSocket("**/*", (socket) => socket.close());
  if (signedIn) await installAuthenticatedFixture(page, { tier });
  await page.addInitScript(
    ({ theme, owner, saved, chatA, chatB }) => {
      localStorage.setItem("kova-theme-mode", theme);
      if (saved) {
        const conversations = [chatA, chatB].map((id, index) => ({
          id,
          title: index ? "Second review chat" : "Composer review chat",
          mode: "instant",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: index
            ? []
            : [
                { id: "prompt-a", role: "user", content: "Draft a release checklist." },
                {
                  id: "answer-a",
                  role: "assistant",
                  content:
                    "A practical release checklist:\n\n1. Review the draft.\n2. Verify the interaction.\n3. Record the result.",
                },
              ],
        }));
        localStorage.setItem(
          `nova-gpt-conversations-v3:user:${owner}`,
          JSON.stringify(conversations),
        );
        localStorage.setItem(`nova-gpt-pending-active:v2:user:${owner}`, chatA);
        localStorage.setItem(`kova-draft-v2:user:${owner}:${chatB}`, "Second chat draft");
      }
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () =>
            Promise.reject(new DOMException("Clipboard unavailable", "NotAllowedError")),
        },
      });
    },
    { theme, owner, saved, chatA, chatB },
  );
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await page.route("**/_serverFn/**", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    const name = functionNames.get(id) ?? "";
    const result = name.startsWith("listProjects_")
      ? [
          {
            id: "33333333-3333-4333-8333-333333333333",
            name: "Review project",
            role: "owner",
            archived_at: null,
            deletion_requested_at: null,
          },
        ]
      : name.startsWith("getMyDailyUsage_")
        ? { chats: 0, images: 0, uploads: 0, resetsAt: "2026-10-17T00:00:00Z" }
        : name.startsWith("getSubscriptionSummary_")
          ? { effectiveTier: tier, tier }
          : name.startsWith("getChatCustomRules_")
            ? { instructions: "", enabled: false }
            : [];
    return route.fulfill({ json: { result, context: {} } });
  });
  await page.route("**/api/library/items**", (route) =>
    route.fulfill({ json: { items: [], cursor: null, hasMore: false } }),
  );
}
