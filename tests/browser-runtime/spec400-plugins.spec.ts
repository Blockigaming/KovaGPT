import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { GoogleStatus } from "../../src/lib/google-client";
type FixtureWindow = Window & { operations: unknown[][]; toasts: string[][] };
if (process.env.KOVA_TEST_CHROMIUM_EXECUTABLE) {
  test.use({ launchOptions: { executablePath: process.env.KOVA_TEST_CHROMIUM_EXECUTABLE } });
}

// Isolated local fixtures: no provider, auth, database, or deployment calls.
const root = process.cwd();
const mocks: Record<string, string> = {
  "@tanstack/react-router": `export const createFileRoute=()=>value=>value;`,
  "@tanstack/react-start": `export const useServerFn=fn=>fn;`,
  "@/components/AppShell": `export const AppShell=({children})=>children;`,
  "@/components/WorkspacePageHeader": `export const WorkspacePageHeader=({title,titleId,description})=><header className="kova-page-header"><h1 id={titleId}>{title}</h1><p>{description}</p></header>;`,
  "@/components/auth/ClerkSafe": `export const useUser=()=>({isLoaded:true,isSignedIn:!!window.testOwner,user:window.testOwner?{id:window.testOwner,primaryEmailAddress:{emailAddress:"owner@example.test",verification:{status:"verified"}}}:null});export const SignInButton=({children})=>children;`,
  "@/components/WorkflowSkillsPanel": `export const WorkflowSkillsPanel=()=>null;`,
  "@/integrations/supabase/client": `export const supabase={auth:{resend:async()=>({error:null})}};`,
  "@/lib/auth-fetch": `export const authFetch=async(...args)=>{window.operations.push(["github-auth",...args]);return {ok:false,json:async()=>({})}};`,
  "@/lib/google-client": `export const getGoogleStatus=async()=>window.googleStatus;export const startGoogleConnect=async(...args)=>{window.operations.push(["google-connect",...args])};export const disconnectGoogleAccount=async(...args)=>{window.operations.push(["google-disconnect",...args]);window.googleStatus={connected:false,state:"disconnected",accounts:[],selectedConnectionId:null,selectionRevision:2}};export const selectGoogleAccount=async(...args)=>window.operations.push(["google-select",...args]);`,
  "@/lib/github.functions": `export const getGitHubManagement=async()=>window.githubData;export const refreshGitHubInstallations=async()=>window.operations.push(["github-refresh"]);export const updateGitHubRepositoryGrants=async(...args)=>window.operations.push(["github-grants",...args]);export const disconnectGitHub=async(...args)=>window.operations.push(["github-disconnect",...args]);`,
  "@/lib/scheduled-tasks.functions": `export const listScheduledTasks=async()=>[];export const listScheduledTaskConnections=async()=>({connections:[],grants:[]});`,
  sonner: `export const toast=Object.fromEntries(["success","error","warning","info"].map(kind=>[kind,(message)=>window.toasts.push([kind,message])]));`,
};
const result = await build({
  stdin: {
    contents: `import React from "react";import{createRoot}from"react-dom/client";import{Route}from"./src/routes/apps.tsx";const root=createRoot(document.getElementById("root"));window.renderPlugins=()=>root.render(React.createElement(Route.component));window.renderPlugins();`,
    resolveDir: root,
    loader: "tsx",
  },
  outfile: "plugins.js",
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  loader: { ".svg": "dataurl" },
  plugins: [
    {
      name: "spec400-plugins-offline-fixtures",
      setup(builder) {
        builder.onResolve({ filter: /^@\// }, (args) =>
          mocks[args.path]
            ? { path: args.path, namespace: "fixture" }
            : {
                path: ["", ".ts", ".tsx", ".mjs"]
                  .map((extension) => path.join(root, "src", args.path.slice(2)) + extension)
                  .find((candidate) => existsSync(candidate))!,
              },
        );
        builder.onResolve({ filter: /^(@tanstack\/react-(router|start)|sonner)$/ }, (args) => ({
          path: args.path,
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: mocks[args.path],
          resolveDir: root,
          loader: "tsx",
        }));
      },
    },
  ],
});
const script = result.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
const css = readFileSync("src/styles/spec400-plugins.css", "utf8");
const emptyGoogle: GoogleStatus = {
  connected: false,
  state: "disconnected",
  accounts: [],
  selectedConnectionId: null,
  selectionRevision: 1,
};
const healthyGoogle: GoogleStatus = {
  connected: true,
  state: "connected",
  email: "connected@example.test",
  scopes: ["gmail.readonly", "calendar.events", "drive.readonly"],
  has: { gmail: true, gmailWrite: true, calendar: true, calendarWrite: true, drive: true },
  selectedConnectionId: "account-1",
  selectionRevision: 1,
  accounts: [
    {
      id: "account-1",
      connectionRevision: 1,
      connected: true,
      state: "connected",
      email: "connected@example.test",
      scopes: ["gmail.readonly", "calendar.events", "drive.readonly"],
    },
  ],
};
async function boot(
  page: import("@playwright/test").Page,
  google = emptyGoogle,
  url = "https://kova-plugins.test/apps",
) {
  await page.route("**/*", (route) =>
    route.request().url().startsWith("https://kova-plugins.test/")
      ? route.fulfill({
          contentType: "text/html",
          body: '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
        })
      : route.abort(),
  );
  await page.goto(url);
  await page.evaluate(
    (google) =>
      Object.assign(window, {
        testOwner: "test-owner",
        operations: [],
        toasts: [],
        googleStatus: google,
        githubData: {
          configured: true,
          accounts: [],
          installations: [],
          repositories: [],
          health: "healthy",
        },
      }),
    google,
  );
  await page.addStyleTag({
    content: `:root { --background:#fff; --foreground:#222; --card:#fafafa; --muted:#eee; --muted-foreground:#666; --border:#ddd; --input:#aaa; --ring:#369; --text-success:#286137; --text-warning:#815300; }*{box-sizing:border-box}body{margin:0;padding:32px;font:15px/1.5 Arial;background:var(--background);color:var(--foreground)}button,input,select{font:inherit}h1,h2,h3,p{margin:0}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}.spec400-plugins{margin:auto}button{cursor:pointer}.spec400-plugin-detail{position:fixed;background:white;z-index:50;overflow-y:auto}.spec400-plugin-detail [data-kova-dialog-close]{position:absolute;right:12px;top:12px;width:44px;height:44px}.spec400-plugin-detail svg{width:20px;height:20px}[role="alertdialog"]{position:fixed;inset:20%;background:white;border:1px solid #888;padding:24px;z-index:100}.spec400-plugin-management button{margin:4px}${css}`,
  });
  await page.addScriptTag({ content: script });
  await expect(page.locator("[data-plugin-id]")).toHaveCount(13);
  await expect(page.locator('[data-plugin-id="gmail"]')).not.toContainText("Checking connection…");
}

test("approved 13-plugin directory supports primary and category filters", async ({ page }) => {
  await boot(page);
  await expect(page.getByRole("heading", { name: "Plugins", exact: true })).toBeVisible();
  await expect(page.getByText("Connect tools and sources to Kova", { exact: true })).toBeVisible();
  await expect(page.locator(".spec400-plugin-logo img")).toHaveCount(13);
  await page.getByRole("combobox", { name: "Category", exact: true }).selectOption("Email");
  await expect(page.locator("[data-plugin-id]")).toHaveCount(2);
  await page.getByRole("textbox", { name: "Search plugins" }).fill("Gmail");
  await expect(page.locator("[data-plugin-id]")).toHaveCount(1);
  await page.getByRole("textbox", { name: "Search plugins" }).fill("missing");
  await expect(page.getByRole("heading", { name: "No matching plugins" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator("[data-plugin-id]")).toHaveCount(13);
  await page.getByRole("tab", { name: /Connected/ }).click();
  await expect(page.getByRole("heading", { name: "No connected plugins" })).toBeVisible();
  expect(await page.evaluate(() => (window as FixtureWindow).operations)).toEqual([]);
});

test("opening and dismissing details never starts OAuth; Connect is explicit", async ({ page }) => {
  await boot(page);
  const trigger = page.getByRole("button", { name: "Connect Gmail", exact: true });
  await trigger.click();
  await expect(page.getByRole("dialog")).toContainText("Capabilities and permissions");
  await expect(page.getByRole("dialog")).toContainText("Google’s consent screen");
  expect(await page.evaluate(() => (window as FixtureWindow).operations)).toEqual([]);
  await page.getByRole("button", { name: "Close plugin details" }).click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("dialog").getByRole("button", { name: "Connect", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).operations.length)).toBe(1);
  expect((await page.evaluate(() => (window as FixtureWindow).operations))[0][0]).toBe(
    "google-connect",
  );
});

test("unavailable providers have readable details and no connection action", async ({ page }) => {
  await boot(page);
  await page.getByRole("button", { name: "Unavailable Slack" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "No account is connected and no permissions have been requested",
  );
  await expect(page.getByRole("dialog").getByRole("button", { name: /^Connect/ })).toHaveCount(0);
  expect(await page.evaluate(() => (window as FixtureWindow).operations)).toEqual([]);
});

test("Manage shows verified account scopes and confirms a disconnect with workflow impact", async ({
  page,
}) => {
  await boot(page, healthyGoogle);
  await page.getByRole("button", { name: "Manage Gmail", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("connected@example.test");
  await page.getByText("Current permission scope", { exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("gmail.readonly");
  await page
    .getByRole("button", { name: "Disconnect connected@example.test", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toContainText("Scheduled tasks or projects");
  expect(await page.evaluate(() => (window as FixtureWindow).operations)).toEqual([]);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await page.evaluate(() => (window as FixtureWindow).operations)).toEqual([]);
  await page
    .getByRole("button", { name: "Disconnect connected@example.test", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Disconnect account", exact: true })
    .click();
  expect((await page.evaluate(() => (window as FixtureWindow).operations))[0][0]).toBe(
    "google-disconnect",
  );
  await expect(page.getByRole("dialog")).toContainText("No Google accounts are connected");
});

test("authorization redirect alone never declares a verified connection", async ({ page }) => {
  await boot(page, emptyGoogle, "https://kova-plugins.test/apps?google_connected=1");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as FixtureWindow).toasts.some((entry: string[]) => entry[0] === "warning"),
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(() =>
      (window as FixtureWindow).toasts.some((entry: string[]) => entry[0] === "success"),
    ),
  ).toBe(false);
  await expect(page.locator('[data-plugin-id="gmail"]')).not.toContainText("Checking connection…");
});

test("cards stay within the phone viewport and detail is full-screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const frame = await page.locator(".spec400-plugin-logo").first().boundingBox();
  expect(frame?.width).toBe(40);
  expect(frame?.height).toBe(40);
  await page.getByRole("button", { name: "Connect Gmail", exact: true }).click();
  const panel = await page.getByRole("dialog").boundingBox();
  // Compare rendered CSS pixels, matching the schedule editor's viewport checks.
  // WebKit can return a 1/64px fractional value for 100dvh.
  expect(Math.round(panel!.width)).toBe(390);
  expect(Math.round(panel!.height)).toBe(844);
});
