import { test, expect } from "@playwright/test";
import { build } from "esbuild";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  org = "33333333-3333-4333-8333-333333333333";
type FixtureWindow = Window & { fixture: { user: string; switchUser: () => void } };
let bundle = "";
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{OrganizationScimControls}from'./src/components/OrganizationScimControls';window.fixture={user:'${owner}'};function Harness(){const[user,setUser]=useState('${owner}');window.fixture.switchUser=()=>{window.fixture.user='${other}';setUser('${other}')};return <OrganizationScimControls key={user} userId={user} organizationId='${org}'/>}createRoot(document.getElementById('root')).render(<Harness/>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    plugins: [
      {
        name: "fixture-auth",
        setup(builder) {
          builder.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({
            path: "supabase",
            namespace: "fixture",
          }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            loader: "js",
            contents:
              "export const supabase={auth:{getSession:async()=>({data:{session:{user:{id:window.fixture.user},access_token:'fixture-token'}}})}}",
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles[0].text;
});
async function mount(page: import("@playwright/test").Page) {
  await page.route("https://organization-fixture.invalid/", (route) =>
    route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }),
  );
  await page.goto("https://organization-fixture.invalid/");
  await page.addScriptTag({ content: bundle });
}
test("SCIM owner consent pins organization, principal and revision; secret is removed across account changes", async ({
  page,
}) => {
  const calls: Record<string, unknown>[] = [];
  await page.route("**/api/organizations/scim**", async (route) => {
    if (route.request().method() === "GET") {
      const user = new URL(route.request().url()).searchParams.get("expectedUserId");
      await route.fulfill({
        json:
          user === owner
            ? {
                available: true,
                providerReady: true,
                enabled: false,
                revision: 7,
                users: 0,
                groups: 0,
              }
            : { available: false },
      });
    } else {
      calls.push(route.request().postDataJSON());
      await route.fulfill({
        json: { available: true, enabled: true, revision: 8, token: "private-one-time-token" },
      });
    }
  });
  await mount(page);
  const issue = page.getByRole("button", { name: "Issue provisioning token" });
  await expect(issue).toBeDisabled();
  await page.getByRole("checkbox").check();
  await issue.click();
  await expect(page.getByLabel("One-time SCIM token")).toHaveValue("private-one-time-token");
  expect(calls).toEqual([
    {
      expectedUserId: owner,
      organizationId: org,
      operation: "rotate",
      expectedRevision: 7,
      consent: true,
    },
  ]);
  await page.evaluate(() => (window as FixtureWindow).fixture.switchUser());
  await expect(page.getByLabel("One-time SCIM token")).toHaveCount(0);
  await expect(page.getByText("Provisioning is awaiting operator activation.")).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(
    "private-one-time-token",
  );
});
test("late token-issue response cannot enter another principal session", async ({ page }) => {
  let release: (() => void) | undefined;
  await page.route("**/api/organizations/scim**", async (route) => {
    if (route.request().method() === "GET")
      await route.fulfill({
        json: { available: true, providerReady: true, enabled: false, revision: 1 },
      });
    else {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route
        .fulfill({
          json: { available: true, enabled: true, revision: 2, token: "late-private-token" },
        })
        .catch(() => {});
    }
  });
  await mount(page);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Issue provisioning token" }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.evaluate(() => (window as FixtureWindow).fixture.switchUser());
  release!();
  await expect(page.getByRole("button", { name: "Issue provisioning token" })).toBeDisabled();
  await expect(page.getByLabel("One-time SCIM token")).toHaveCount(0);
});
