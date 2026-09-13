import { expect, test } from "@playwright/test";
import { installAuthenticatedFixture } from "./authenticated-fixture";
const owner = "22222222-2222-4222-8222-222222222222",
  id = "11111111-1111-4111-8111-111111111111",
  generation = "33333333-3333-4333-8333-333333333333";
const user = {
  id: owner,
  aud: "authenticated",
  role: "authenticated",
  email: "library@example.invalid",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  confirmed_at: "2026-01-01T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  factors: [],
  created_at: "2026-01-01T00:00:00Z",
  is_anonymous: false,
};
async function fixture(page: import("@playwright/test").Page) {
  await installAuthenticatedFixture(page);
  await page.addInitScript(
    ({ user }) => {
      const native = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key: string) {
        if (this === localStorage && /^sb-127-auth-token$/.test(key)) {
          const now = Math.floor(Date.now() / 1000),
            b64 = (x: unknown) =>
              btoa(JSON.stringify(x)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
          return JSON.stringify({
            access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: `${location.origin}/auth/v1`, aud: "authenticated", role: "authenticated", sub: user.id, email: user.email, aal: "aal1", iat: now, exp: now + 3600 })}.c2ln`,
            refresh_token: "fixture",
            expires_at: now + 3600,
            expires_in: 3600,
            token_type: "bearer",
            user,
          });
        }
        return native.call(this, key);
      };
    },
    { user },
  );
  await page.route("**/auth/v1/**", (route) => route.fulfill({ json: user }));
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await page.route("**/_serverFn/**", (route) =>
    route.fulfill({ json: { result: [], context: {} } }),
  );
  await page.route("**/api/library/folders", (route) => route.fulfill({ json: { folders: [] } }));
  const state = {
    revision: 1,
    text: "private full text",
    listCalls: [] as Record<string, unknown>[],
    writes: [] as Record<string, unknown>[],
    downloads: 0,
  };
  const row = () => ({
    id,
    user_id: owner,
    title: "Versioned note",
    item_type: "document",
    source: "manual",
    content_text: state.text,
    content_excerpt: "private preview",
    file_url: null,
    file_name: "Note.txt",
    file_type: "text/plain",
    file_size: 17,
    folder_id: null,
    metadata: {},
    content_generation: generation,
    content_revision: state.revision,
    created_at: "2026-09-01T00:00:00Z",
  });
  await page.route("**/api/library/files**", async (route) => {
    expect(route.request().headers()["x-kova-owner"]).toBe(owner);
    expect(new URL(route.request().url()).searchParams.get("generation")).toBe(generation);
    state.downloads++;
    return route.fulfill({ contentType: "application/pdf", body: "%PDF-1.7 original fixture" });
  });
  await page.route("**/api/library/items**", async (route) => {
    expect(route.request().headers()["x-kova-owner"]).toBe(owner);
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    const url = new URL(route.request().url());
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      if (body.operation === "list") {
        state.listCalls.push(body);
        const first = !body.cursor;
        return route.fulfill({
          json: {
            items:
              body.query === "missing"
                ? []
                : first
                  ? [
                      row(),
                      {
                        ...row(),
                        id: "55555555-5555-4555-8555-555555555555",
                        title: "Original PDF",
                        file_url: `${owner}/${generation}.pdf`,
                        file_name: "Original.pdf",
                        file_type: "application/pdf",
                        metadata: { file_bucket: "library-files", storage_generation: generation },
                      },
                    ]
                  : [{ ...row(), id: "44444444-4444-4444-8444-444444444444", title: "Older note" }],
            cursor:
              first && !body.query
                ? {
                    id,
                    sort: "newest",
                    query: "",
                    folder: "all",
                    filter: "all",
                    created_at: row().created_at,
                  }
                : null,
          },
        });
      }
      state.writes.push(body);
      expect(body.generation).toBe(generation);
      expect(body.revision).toBe(state.revision);
      state.text = body.text;
      state.revision++;
      return route.fulfill({ json: { revision: state.revision } });
    }
    if (url.searchParams.get("history"))
      return route.fulfill({
        json: {
          supported: true,
          versions: [
            {
              kind: "text",
              revision: state.revision,
              file_name: "Note.txt",
              file_type: "text/plain",
              size_bytes: state.text.length,
              created_at: "2026-09-01T00:00:00Z",
              current: true,
            },
          ],
        },
      });
    if (url.searchParams.get("revision"))
      return route.fulfill({ json: { content_text: state.text, revision: state.revision } });
    return route.fulfill({ json: row() });
  });
  return state;
}
test("Library pages use the raw owner, load complete private text and save an exact text revision", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/library");
  await expect(page.getByText("Versioned note", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Load more saved items" }).click();
  await expect(page.getByText("Older note", { exact: true }).first()).toBeVisible();
  expect(state.listCalls.some((x) => !!x.cursor)).toBe(true);
  await page.getByRole("button", { name: "Actions for Original PDF" }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Download original" }).click();
  expect((await downloaded).suggestedFilename()).toBe("Original.pdf");
  expect(state.downloads).toBe(1);
  await page.getByRole("button", { name: "Actions for Versioned note" }).click();
  await page.getByRole("menuitem", { name: "Versions and replacement" }).click();
  const dialog = page.getByRole("dialog", { name: "Versions of Versioned note" });
  await expect(dialog.getByRole("textbox")).toHaveValue("private full text");
  await dialog.getByRole("textbox").fill("corrected private text");
  await dialog.getByRole("button", { name: "Save text as new version" }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].text).toBe("corrected private text");
  await page.getByRole("textbox", { name: "Search Library" }).fill("missing");
  await expect(page.getByRole("heading", { name: "No matches" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search Library" })).toBeVisible();
});
test("clearing browser data closes private versions and does not refill Library through a delayed refresh", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/library");
  await expect(page.getByText("Versioned note", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Actions for Versioned note" }).click();
  await page.getByRole("menuitem", { name: "Versions and replacement" }).click();
  await expect(page.getByRole("dialog", { name: "Versions of Versioned note" })).toBeVisible();
  const before = state.listCalls.length;
  await page.evaluate(
    (principal) =>
      window.dispatchEvent(
        new CustomEvent("kova:principal-browser-storage-cleared", { detail: { principal } }),
      ),
    `user:${owner}`,
  );
  await expect(
    page.getByText("Saved browser data was cleared. Reload this page to reopen Library."),
  ).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Versions of Versioned note" })).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(state.listCalls.length).toBe(before);
  expect(state.writes.length).toBe(0);
});
