import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { GoogleStatus } from "../../src/lib/google-client";
import type { AccountStatus } from "../../src/hooks/use-connected-accounts";
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
  "@/lib/auth-fetch": `export const authFetch=async(url,init)=>{if(url==="/api/integrations/accounts")return {ok:true,json:async()=>window.otherStatus};window.operations.push([url.startsWith("/api/integrations/")?"provider-request":"github-auth",url,init]);if(url.endsWith("/disconnect")){window.otherStatus.accounts=[];return {ok:true,json:async()=>({providerRevoked:false})}}return {ok:false,json:async()=>({})}};export const fetchWithTimeoutAuthenticated=authFetch;`,
  "@/lib/connected-accounts.functions": `export const searchConnectedAccount=async({data})=>{window.operations.push(["provider-read",data]);return {service:"Outlook",results:[{id:"result-1",title:"Actual fixture result",url:"https://outlook.live.com/mail/result-1",snippet:"Read result from the isolated fixture"}],limited:true}};export const refreshConnectedAccess=async()=>({ok:true});`,
  "@/lib/google-client": `export const getGoogleStatus=async()=>window.googleStatus;export const startGoogleConnect=async(...args)=>{window.operations.push(["google-connect",...args])};export const disconnectGoogleAccount=async(...args)=>{window.operations.push(["google-disconnect",...args]);window.googleStatus={connected:false,state:"disconnected",accounts:[],selectedConnectionId:null,selectionRevision:2}};export const selectGoogleAccount=async(...args)=>window.operations.push(["google-select",...args]);`,
  "@/lib/github.functions": `export const getGitHubManagement=async()=>window.githubData;export const refreshGitHubInstallations=async()=>window.operations.push(["github-refresh"]);export const updateGitHubRepositoryGrants=async(...args)=>window.operations.push(["github-grants",...args]);export const disconnectGitHub=async(...args)=>window.operations.push(["github-disconnect",...args]);`,
  "@/lib/scheduled-tasks.functions": `export const listScheduledTasks=async()=>[];export const listScheduledTaskConnections=async()=>({connections:[],grants:[]});`,
  sonner: `export const toast=Object.fromEntries(["success","error","warning","info","message"].map(kind=>[kind,(message)=>window.toasts.push([kind,message])]));`,
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
  other: AccountStatus = { configuredProviders: [], accounts: [] },
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
    ({ google, other }) =>
      Object.assign(window, {
        testOwner: "test-owner",
        operations: [],
        toasts: [],
        googleStatus: google,
        otherStatus: other,
        githubData: {
          configured: true,
          accounts: [],
          installations: [],
          repositories: [],
          health: "healthy",
        },
      }),
    { google, other },
  );
  // esbuild does not compile Tailwind utilities. Mirror DialogContent's individual
  // -translate-x-1/2 and -translate-y-1/2 positioning in this isolated harness.
  await page.addStyleTag({
    content: `:root { --background:#fff; --foreground:#222; --card:#fafafa; --muted:#eee; --muted-foreground:#666; --border:#ddd; --input:#aaa; --ring:#369; --text-success:#286137; --text-warning:#815300; }*{box-sizing:border-box}body{margin:0;padding:32px;font:15px/1.5 Arial;background:var(--background);color:var(--foreground)}button,input,select{font:inherit}h1,h2,h3,p{margin:0}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}.spec400-plugins{margin:auto}button{cursor:pointer}.spec400-plugin-detail{position:fixed;background:white;z-index:50;overflow-y:auto;translate:-50% -50%}.spec400-plugin-detail [data-kova-dialog-close]{position:absolute;right:12px;top:12px;width:44px;height:44px}.spec400-plugin-detail svg{width:20px;height:20px}[role="alertdialog"]{position:fixed;inset:20%;background:white;border:1px solid #888;padding:24px;z-index:100}.spec400-plugin-management button{margin:4px}${css}`,
  });
  await page.addScriptTag({ content: script });
  await expect(page.locator("[data-plugin-id]")).toHaveCount(13);
  await expect(page.locator('[data-plugin-id="gmail"]')).not.toContainText("Checking connection…");
}

test("approved 13-plugin directory supports primary and category filters", async ({ page }) => {
  await boot(page);
  await expect(page.getByRole("heading", { name: "Connections", exact: true })).toBeVisible();
  await expect(page.getByText("Connect tools and sources to Kova", { exact: true })).toBeVisible();
  await expect(page.locator(".spec400-plugin-logo img")).toHaveCount(13);
  await page.getByRole("combobox", { name: "Category", exact: true }).click();
  await page.getByRole("option", { name: "Email", exact: true }).click();
  await expect(page.locator("[data-plugin-id]")).toHaveCount(2);
  await page.getByRole("textbox", { name: "Search connections" }).fill("Gmail");
  await expect(page.locator("[data-plugin-id]")).toHaveCount(1);
  await page.getByRole("textbox", { name: "Search connections" }).fill("missing");
  await expect(page.getByRole("heading", { name: "No matching connections" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator("[data-plugin-id]")).toHaveCount(13);
  await page.getByRole("tab", { name: /Connected/ }).click();
  await expect(page.getByRole("heading", { name: "No connections yet" })).toBeVisible();
  expect(await page.evaluate(() => (window as FixtureWindow).operations)).toEqual([]);
});

test("opening and dismissing details never starts OAuth; Connect is explicit", async ({ page }) => {
  await boot(page);
  const trigger = page.getByRole("button", { name: "Connect Gmail", exact: true });
  await trigger.click();
  await expect(page.getByRole("dialog")).toContainText("Capabilities and permissions");
  await expect(page.getByRole("dialog")).toContainText("Google’s consent screen");
  expect(await page.evaluate(() => (window as FixtureWindow).operations)).toEqual([]);
  await page.getByRole("button", { name: "Close connection details" }).click();
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
    "Connection setup is incomplete in this deployment.",
  );
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Connect", exact: true }),
  ).toBeDisabled();
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

test("connection cards fit the phone and details stay centered with viewport gutters", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const frame = await page.locator(".spec400-plugin-logo").first().boundingBox();
  expect(frame).not.toBeNull();
  expect(frame!.width).toBe(frame!.height);
  expect(frame!.width).toBeGreaterThanOrEqual(40);
  expect(frame!.width).toBeLessThanOrEqual(64);
  await page.getByRole("button", { name: "Connect Gmail", exact: true }).click();
  const panel = await page.getByRole("dialog").boundingBox();
  expect(panel).not.toBeNull();
  expect(panel!.x).toBeGreaterThanOrEqual(11);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(379);
  expect(panel!.y).toBeGreaterThanOrEqual(11);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(833);
  expect(Math.abs(panel!.x + panel!.width / 2 - 195)).toBeLessThan(1);
  await expect(page.getByRole("button", { name: "Close connection details" })).toBeVisible();
});

test("Microsoft account management searches only the explicitly selected authorized account", async ({
  page,
}) => {
  await boot(page, emptyGoogle, "https://kova-plugins.test/apps", {
    configuredProviders: [{ id: "microsoft" }],
    accounts: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        provider_id: "microsoft",
        account_label: "mail@example.test",
        status: "connected",
        granted_scopes: ["Mail.Read"],
        token_expires_at: null,
      },
    ],
  });
  await page.getByRole("button", { name: "Manage Outlook", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("mail@example.test");
  await dialog.getByRole("textbox", { name: "Search Outlook", exact: true }).fill("receipt");
  await dialog.getByRole("button", { name: "Search this account", exact: true }).click();
  await expect(
    dialog.getByRole("link", { name: "Actual fixture result", exact: true }),
  ).toBeVisible();
  expect((await page.evaluate(() => (window as FixtureWindow).operations))[0]).toEqual([
    "provider-read",
    {
      connectionId: "outlook",
      accountId: "11111111-1111-4111-8111-111111111111",
      query: "receipt",
    },
  ]);
  await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Other Microsoft services");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await page.evaluate(() => (window as FixtureWindow).operations)).length).toBe(1);
});

test("opening a configured provider never starts OAuth until Connect is clicked", async ({
  page,
}) => {
  await boot(page, emptyGoogle, "https://kova-plugins.test/apps", {
    configuredProviders: [{ id: "microsoft" }],
    accounts: [],
  });
  await page.getByRole("button", { name: "Connect Outlook", exact: true }).click();
  expect(await page.evaluate(() => (window as FixtureWindow).operations)).toEqual([]);
  await page.getByRole("dialog").getByRole("button", { name: "Connect", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).operations.length)).toBe(1);
  const operation = (await page.evaluate(() => (window as FixtureWindow).operations))[0];
  expect(operation[1]).toBe("/api/integrations/oauth/start");
  const body = JSON.parse((operation[2] as { body: string }).body);
  expect(body.provider).toBe("microsoft");
  expect(body.optionalScopes).toEqual(["Mail.Read"]);
});
