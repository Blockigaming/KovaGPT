import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { statSync, readFileSync } from "node:fs";
import type { GoogleStatus } from "../../src/lib/google-client";
import type { AccountStatus } from "../../src/hooks/use-connected-accounts";
import { MASTER_CONNECTORS } from "../../src/lib/connector-master-list.mjs";
type FixtureWindow = Window & { operations: unknown[][]; toasts: string[][]; readError?: string };
if (process.env.KOVA_TEST_CHROMIUM_EXECUTABLE) {
  test.use({ launchOptions: { executablePath: process.env.KOVA_TEST_CHROMIUM_EXECUTABLE } });
}

// Isolated local fixtures: no provider, auth, database, or deployment calls.
const root = process.cwd();
const mocks: Record<string, string> = {
  "@tanstack/react-router": `
    import {useCallback,useSyncExternalStore} from "react";
    const subscribe = (notify) => {
      addEventListener("popstate",notify);
      return () => removeEventListener("popstate",notify);
    };
    export const useLocation = ({select}) => select({
      searchStr:useSyncExternalStore(subscribe,()=>window.location.search)
    });
    export const useNavigate = () => useCallback(({to,search,replace}={})=>{
      const url=new URL(to??location.pathname,location.href);
      if (search) url.search=new URLSearchParams(search).toString();
      history[replace?"replaceState":"pushState"]({}, "", url);
      dispatchEvent(new PopStateEvent("popstate"));
      return Promise.resolve();
    },[]);
    export const createFileRoute = () => (route) => route;
    export const Link = ({ to, ...props }) => <a href={to} {...props} />;
  `,
  "@tanstack/react-start": `export const useServerFn=fn=>fn;export const createClientOnlyFn=fn=>fn;`,
  "@/components/AppShell": `export const AppShell=({children})=>children;`,
  "@/components/WorkspacePageHeader": `export const WorkspacePageHeader=({title,titleId,description,actions})=><header className="kova-page-header"><h1 id={titleId}>{title}</h1><p>{description}</p>{actions}</header>;`,
  "@/components/auth/ClerkSafe": `export const useUser=()=>({isLoaded:true,isSignedIn:!!window.testOwner,user:window.testOwner?{id:window.testOwner,primaryEmailAddress:{emailAddress:"owner@example.test",verification:{status:"verified"}}}:null});export const SignInButton=({children})=>children;`,
  "@/components/WorkflowSkillsPanel": `export const WorkflowSkillsPanel=()=>null;`,
  "@/integrations/supabase/client": `export const getSupabaseClientConfigStatus=()=>({configured:false});export const supabase={auth:{resend:async()=>({error:null})}};`,
  "@/utils/plan.functions": `export const getMyPlanTier=async({data})=>({ownerId:data.ownerId,tier:window.testTier??'free'});`,

  "@/lib/auth-fetch": `export const authFetch=async(url,init)=>{if(url==="/api/integrations/accounts")return {ok:true,json:async()=>window.otherStatus};if(url==="/api/finances/manage"&&init?.method!=="POST")return {ok:true,json:async()=>({configured:false,planEligible:false,connections:[]})};window.operations.push([url.startsWith("/api/integrations/")?"provider-request":"github-auth",url,init]);if(url.endsWith("/disconnect")){window.otherStatus.accounts=[];return {ok:true,json:async()=>({providerRevoked:false})}}return {ok:false,json:async()=>({})}};export const fetchWithTimeoutAuthenticated=authFetch;`,
  "@/lib/connected-accounts.functions": `export const searchConnectedAccount=async({data,headers})=>{if(headers?.["X-Kova-Owner"]!==window.testOwner)throw new Error("Owner binding is required");window.operations.push(["provider-read",data]);if(window.readError)return {error:window.readError};return {service:"Outlook",results:[{id:"result-1",title:"Actual fixture result",url:"https://outlook.live.com/mail/result-1",snippet:"Read result from the isolated fixture"}],limited:true}};export const refreshConnectedAccess=async()=>({ok:true});`,
  "@/lib/connector-write.functions": `
    export const getConnectorWriteAccess=async()=>({enabled:!!window.writeAccess});
    export const setConnectorWriteAccess=async({data})=>{window.operations.push(["write-access",data]);window.writeAccess=data.enabled;return {enabled:data.enabled}};
    export const createOneDriveFolder=async({data})=>{window.operations.push(["create-folder",data]);return {created:true}};
    export const createOutlookDraft=async({data})=>{window.operations.push(["create-draft",data]);return {created:true}};
    export const sendOutlookMessage=async({data})=>{window.operations.push(["send-outlook",data]);return {created:true}};
    export const createLinearIssue=async({data})=>{window.operations.push(["create-linear-issue",data]);return {created:true}};
    export const createOutlookEvent=async({data})=>{window.operations.push(["create-event",data]);return {created:true}};
    export const createGoogleDriveFolder=async({data})=>{window.operations.push(["drive-folder",data]);return {created:true}};
    export const runConnectorWriteAction=async({data,headers})=>{if(headers?.["X-Kova-Owner"]!==window.testOwner)throw new Error("Owner binding is required");window.operations.push(["reviewed-provider-write",data]);return {ok:true}};
    export const loadTanaProposalSchema=async()=>({schema:"{}"});
  `,
  "@/lib/connector-submissions.functions": `
    export const listPublishedConnectorSubmissions=async()=>[];
    export const listConnectorSubmissions=async()=>({own:window.submissions??[],queue:[],reviewer:false});
    export const checkConnectorSource=async({data})=>{window.operations.push(["validate-source",data]);return {label:"HTTPS URL saved for manual server review",reference:null}};
    export const saveConnectorSubmission=async({data})=>{
      const row={...data,revision:data.revision+1,status:"draft",review_note:null,updated_at:"2026-11-23"};
      window.submissions=[row]; return row;
    };
    export const submitConnectorForReview=async({data})=>{
      const row={...window.submissions[0],status:"submitted"}; window.submissions=[row];
      window.operations.push(["submit-for-review",data]); return row;
    };
    export const reviewConnectorSubmission=async()=>({saved:true});
  `,
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
  loader: { ".svg": "dataurl", ".png": "dataurl" },
  external: ["/images/connector-tint-dither.png"],
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
                  .find((candidate) => statSync(candidate, { throwIfNoEntry: false })?.isFile())!,
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
      has: { gmail: true, gmailWrite: true, calendar: true, calendarWrite: true, drive: true },
      scopes: ["gmail.readonly", "calendar.events", "drive.readonly"],
    },
  ],
};
async function boot(
  page: import("@playwright/test").Page,
  google = emptyGoogle,
  url = "https://kova-plugins.test/apps",
  other: AccountStatus = { configuredProviders: [], accounts: [] },
  tier: "free" | "plus" = "free",
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
    ({ google, other, tier }) =>
      Object.assign(window, {
        testOwner: "test-owner",
        testTier: tier,
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
    { google, other, tier },
  );
  // esbuild does not compile Tailwind utilities. Mirror DialogContent's individual
  // -translate-x-1/2 and -translate-y-1/2 positioning in this isolated harness.
  await page.addStyleTag({
    content: `:root { --background:#fff; --foreground:#222; --card:#fafafa; --muted:#eee; --muted-foreground:#666; --border:#ddd; --input:#aaa; --ring:#369; --text-success:#286137; --text-warning:#815300; }*{box-sizing:border-box}body{margin:0;padding:32px;font:15px/1.5 Arial;background:var(--background);color:var(--foreground)}button,input,select{font:inherit}h1,h2,h3,p{margin:0}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}.spec400-plugins{margin:auto}button{cursor:pointer}.spec400-plugin-detail{position:fixed;background:white;z-index:50;overflow-y:auto;translate:-50% -50%}.spec400-plugin-detail [data-kova-dialog-close]{position:absolute;right:12px;top:12px;width:44px;height:44px}.spec400-plugin-detail svg{width:20px;height:20px}[role="alertdialog"]{position:fixed;inset:20%;background:white;border:1px solid #888;padding:24px;z-index:100}.spec400-plugin-management button{margin:4px}${css}`,
  });
  await page.addScriptTag({ content: script });
  if (!url.includes("directory=") && !url.includes("plugin=")) {
    await expect(page.locator("[data-plugin-id]")).toHaveCount(MASTER_CONNECTORS.length + 1);
    await expect(page.locator('[data-plugin-id="gmail"]')).not.toContainText(
      "Checking connection…",
    );
  }
}

test("approved directory keeps all providers and offers Health examples and search", async ({
  page,
}) => {
  await boot(page);
  await expect(page.getByRole("heading", { name: "Connections", exact: true })).toBeVisible();
  const picker = page.getByRole("tablist", { name: "Connections" });
  await expect(picker.getByRole("tab")).toHaveText(["All", "Connected", "Health", "Finances"]);
  await picker.getByRole("tab", { name: "Finances" }).click();
  await expect(page.getByText("Sample data").first()).toBeVisible();
  await picker.getByRole("tab", { name: "Health" }).click();
  const health = page.getByRole("region", { name: "Health trends", exact: true });
  await expect(health.getByText("Example data")).toBeVisible();
  await expect(health.getByRole("heading", { name: "Steps", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Connect Health", exact: true }).click();
  const chooser = page.getByRole("dialog", { name: "Connect Health", exact: true });
  await expect(chooser.getByText("Apple Health", { exact: true })).toBeVisible();
  await expect(chooser.getByText("Requires iPhone app", { exact: true })).toBeVisible();
  await expect(chooser.getByText("Requires Android app", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await picker.getByRole("tab", { name: "All" }).click();
  await expect(
    page.getByText("Browse and manage the tools you use with KovaGPT.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".spec400-plugin-logo")).toHaveCount(MASTER_CONNECTORS.length + 1);
  for (const item of MASTER_CONNECTORS) {
    await expect(page.locator(`[data-plugin-id="${item.id}"]`)).toHaveCount(1);
  }
  await expect(page.locator('[data-plugin-id="hubspot"]')).toHaveCount(0);
  const plaid = page.locator('[data-plugin-id="plaid"]');
  await expect(plaid.getByRole("button", { name: "Details Plaid" })).toBeVisible();
  await expect(plaid.getByText("Coming soon")).toHaveCount(0);
  for (const id of ["granola", "tana", "google-docs"]) {
    const card = page.locator(`[data-plugin-id="${id}"]`);
    await expect(card.getByText("Coming soon", { exact: true })).toBeVisible();
    await expect(card.getByRole("button")).toHaveCount(0);
  }
  await expect(page.getByRole("combobox", { name: "Category", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Email", exact: true }).click();
  await expect(page.locator('[data-plugin-id="github"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Email · Clear category", exact: true }).click();
  await expect(page.locator("[data-plugin-id]")).toHaveCount(MASTER_CONNECTORS.length + 1);
  await page.getByRole("textbox", { name: "Search connections" }).fill("Gmail");
  await expect(page.locator("[data-plugin-id]")).toHaveCount(1);
  await page.getByRole("textbox", { name: "Search connections" }).fill("missing");
  await expect(page.getByRole("heading", { name: "No matching connections" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator("[data-plugin-id]")).toHaveCount(MASTER_CONNECTORS.length + 1);
  await page.getByRole("tab", { name: /Connected/ }).click();
  await expect(page.getByRole("heading", { name: "No connections yet" })).toBeVisible();
  expect(await page.evaluate(() => (window as FixtureWindow).operations)).toEqual([]);
});

test("Excalidraw opens a drawing from Connections and downloads it locally", async ({ page }) => {
  await boot(page);
  await page.locator('[data-plugin-id="excalidraw"]').getByRole("button").click();
  await page.getByRole("button", { name: "Draw and export" }).click();
  const dialog = page.getByRole("dialog", { name: "Drawing", exact: true });
  const save = dialog.getByRole("button", { name: "Download Excalidraw file" });
  await expect(save).toBeDisabled();
  const canvas = dialog.getByLabel("Drawing canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 70, box.y + 60, { steps: 3 });
  await page.mouse.up();
  await expect(save).toBeEnabled();
  const download = page.waitForEvent("download");
  await save.click();
  await expect.poll(async () => (await download).suggestedFilename()).toMatch(/\.excalidraw$/u);
  expect(await page.evaluate(() => (window as FixtureWindow).operations)).toEqual([]);
});

test("Gmail supports locally enforced read and write settings", async ({ page }) => {
  await boot(page, healthyGoogle, undefined, undefined, "plus");
  await page.getByRole("button", { name: "Connected Gmail", exact: true }).click();
  await page.getByRole("button", { name: "Permissions for connected@example.test" }).click();
  const permissions = page.getByRole("dialog", { name: "Permissions", exact: true });
  await expect(permissions.getByRole("button", { name: "Read only" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await permissions.getByRole("button", { name: "Read and write" }).click();
  await expect(permissions.getByRole("button", { name: "Read and write" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await permissions.getByRole("button", { name: "Read only" }).click();
  await expect(permissions.getByRole("button", { name: "Read only" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(await page.evaluate(() => (window as FixtureWindow).operations)).toEqual([
    ["write-access", { enabled: true, subject: { connector: "gmail", target: "account-1" } }],
    ["write-access", { enabled: false, subject: { connector: "gmail", target: "account-1" } }],
  ]);
});

test("MCP submission validates, saves each step, and enters review", async ({ page }) => {
  await boot(page, emptyGoogle, "https://kova-plugins.test/apps?directory=submissions");
  await page.getByRole("button", { name: "New submission" }).click();
  await page.getByRole("button", { name: /Remote MCP connector/ }).click();
  await page.getByRole("button", { name: "Add MCP server" }).click();
  const server = page.getByRole("dialog", { name: "Add MCP server" });
  await server.getByLabel("MCP server URL").fill("https://connector.example.com/mcp");
  await server.getByRole("button", { name: "Save server" }).click();
  await page.getByRole("button", { name: "Validate source" }).click();
  await expect(page.getByText("HTTPS URL saved for manual server review")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Plugin name").fill("Example connector");
  await page.getByLabel("Description", { exact: true }).fill("Search a test workspace.");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Check server registration" }).click();
  await expect(page.getByText("HTTPS URL saved for manual server review")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel(/Describe the data collected/).fill("Only searches authorized data.");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Contact email").fill("author@example.com");
  await page.getByRole("checkbox", { name: /authorized to submit/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByRole("heading", { name: "Example connector" })).toBeVisible();
  await expect(page.getByText("In review · Remote MCP connector")).toBeVisible();
});

test("OneDrive confirms the folder name before writing", async ({ page }) => {
  await boot(page, emptyGoogle, undefined, {
    configuredProviders: [
      {
        id: "microsoft",
        name: "Microsoft",
        requiredScopes: [],
        optionalScopes: ["Files.ReadWrite"],
      },
    ],
    accounts: [
      {
        id: "fixture-onedrive",
        provider_id: "microsoft",
        account_label: "OneDrive test account",
        status: "connected",
        granted_scopes: ["Files.ReadWrite"],
        token_expires_at: null,
        deleted_at: null,
      },
    ],
  });
  await page.getByRole("button", { name: "Connected OneDrive", exact: true }).click();
  await page.getByRole("button", { name: "Permissions for OneDrive test account" }).click();
  const permissions = page.getByRole("dialog", { name: "Permissions", exact: true });
  await permissions.getByRole("button", { name: "Read and write" }).click();
  await permissions.getByLabel("Folder name in My files").fill("Example folder");
  await permissions.getByRole("button", { name: "Review folder" }).click();
  await expect(permissions.getByText("Example folder")).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as FixtureWindow).operations.filter(([kind]) => kind === "create-folder"),
    ),
  ).toEqual([]);
  await permissions.getByRole("button", { name: "Create folder" }).click();
  await expect(permissions.getByText("Folder created in OneDrive.")).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as FixtureWindow).operations.filter(([kind]) => kind === "create-folder"),
    ),
  ).toEqual([["create-folder", { target: "fixture-onedrive", name: "Example folder" }]]);
});

test("Slack separates write consent, Kova access, and review of the exact message", async ({
  page,
}) => {
  const accountId = "00000000-0000-4000-8000-000000000002";
  const channel = "C0123456789";
  await boot(page, emptyGoogle, undefined, {
    configuredProviders: [
      {
        id: "slack",
        name: "Slack",
        requiredScopes: ["search:read"],
        optionalScopes: ["chat:write"],
      },
    ],
    accounts: [
      {
        id: accountId,
        provider_id: "slack",
        account_label: "Slack test workspace",
        status: "connected",
        granted_scopes: ["search:read", "chat:write"],
        token_expires_at: null,
        deleted_at: null,
      },
    ],
  });
  await page.getByRole("button", { name: "Connected Slack", exact: true }).click();
  await page.getByRole("button", { name: "Permissions for Slack test workspace" }).click();
  const permissions = page.getByRole("dialog", { name: "Permissions", exact: true });
  await expect(permissions.getByRole("button", { name: "Read only" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(permissions.getByRole("button", { name: "Review action" })).toHaveCount(0);
  await permissions.getByRole("button", { name: "Read and write" }).click();
  await permissions.getByLabel("Slack conversation ID").fill(channel);
  await permissions.getByLabel("Message", { exact: true }).fill("Reviewed message");
  await permissions.getByRole("button", { name: "Review action" }).click();
  await expect(permissions.getByText(channel, { exact: true })).toBeVisible();
  await expect(permissions.getByText("Reviewed message", { exact: true })).toBeVisible();
  const writes = () =>
    page.evaluate(() =>
      (window as FixtureWindow).operations.filter(([kind]) => kind === "reviewed-provider-write"),
    );
  expect(await writes()).toEqual([]);
  await permissions.getByRole("button", { name: "Send Slack message" }).click();
  await expect(permissions.getByRole("status")).toHaveText("The provider confirmed the change.");
  expect(await writes()).toEqual([
    [
      "reviewed-provider-write",
      {
        connector: "slack",
        target: accountId,
        fields: { destination: channel, text: "Reviewed message" },
        confirmed: true,
      },
    ],
  ]);
  await permissions.getByRole("button", { name: "Read only" }).click();
  await expect(permissions.getByRole("button", { name: "Review action" })).toHaveCount(0);
});

test("Granola keeps webhook maintenance off until the owner opts in and confirms", async ({
  page,
}) => {
  const accountId = "00000000-0000-4000-8000-000000000002";
  await boot(page, emptyGoogle, undefined, {
    configuredProviders: [
      {
        id: "granola",
        name: "Granola",
        authentication: "api-key",
        requiredScopes: ["granola:notes:list"],
      },
    ],
    accounts: [
      {
        id: accountId,
        provider_id: "granola",
        account_label: "Granola meeting notes",
        status: "connected",
        granted_scopes: ["granola:notes:list"],
        token_expires_at: null,
        deleted_at: null,
      },
    ],
  });
  await page.getByRole("button", { name: "Connected Granola", exact: true }).click();
  await page.getByRole("button", { name: "Permissions for Granola meeting notes" }).click();
  const panel = page.getByRole("dialog", { name: "Permissions", exact: true });
  await expect(panel.getByRole("button", { name: "Read only" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(panel.getByRole("button", { name: "Review action" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Read and write" }).click();
  await panel.getByLabel("Webhook endpoint ID").fill("whe_TestEndpoint");
  await panel.getByLabel("Delivery (pause or resume)").fill("pause");
  await panel.getByRole("button", { name: "Review action" }).click();
  const writes = () =>
    page.evaluate(() =>
      (window as FixtureWindow).operations.filter(([kind]) => kind === "reviewed-provider-write"),
    );
  expect(await writes()).toEqual([]);
  await panel.getByRole("button", { name: "Pause or resume a Granola webhook" }).click();
  await expect.poll(writes).toEqual([
    [
      "reviewed-provider-write",
      {
        connector: "granola",
        target: accountId,
        fields: { destination: "whe_TestEndpoint", delivery: "pause" },
        confirmed: true,
      },
    ],
  ]);
});

test("Slack requests its additional provider scope only when write access is selected", async ({
  page,
}) => {
  const accountId = "00000000-0000-4000-8000-000000000002";
  await boot(page, emptyGoogle, undefined, {
    configuredProviders: [
      {
        id: "slack",
        name: "Slack",
        requiredScopes: ["search:read"],
        optionalScopes: ["chat:write"],
      },
    ],
    accounts: [
      {
        id: accountId,
        provider_id: "slack",
        account_label: "Read-only Slack workspace",
        status: "connected",
        granted_scopes: ["search:read"],
        token_expires_at: null,
        deleted_at: null,
      },
    ],
  });
  await page.getByRole("button", { name: "Connected Slack", exact: true }).click();
  await page.getByRole("button", { name: "Reconnect or add read access", exact: true }).click();
  await page.getByRole("button", { name: "Permissions for Read-only Slack workspace" }).click();
  const permissions = page.getByRole("dialog", { name: "Permissions", exact: true });
  await permissions.getByRole("button", { name: "Read and write" }).click();
  const operations = await page.evaluate(() => (window as FixtureWindow).operations);
  expect(operations.map(([kind, endpoint]) => [kind, endpoint])).toEqual([
    ["provider-request", "/api/integrations/oauth/start"],
    ["provider-request", "/api/integrations/oauth/start"],
  ]);
  const [read, write] = operations.map(([, , init]) => JSON.parse((init as { body: string }).body));
  expect(read).toMatchObject({ existingAccountId: accountId, optionalScopes: ["search:read"] });
  expect(write).toMatchObject({
    existingAccountId: accountId,
    optionalScopes: ["search:read", "chat:write"],
  });
  await expect(permissions.getByRole("button", { name: "Review action" })).toHaveCount(0);
});

test("Linear reviews the team and issue before writing", async ({ page }) => {
  const accountId = "00000000-0000-4000-8000-000000000002";
  const teamId = "00000000-0000-4000-8000-000000000003";
  await boot(page, emptyGoogle, undefined, {
    configuredProviders: [
      { id: "linear", name: "Linear", requiredScopes: ["read"], optionalScopes: ["issues:create"] },
    ],
    accounts: [
      {
        id: accountId,
        provider_id: "linear",
        account_label: "Linear test workspace",
        status: "connected",
        granted_scopes: ["read", "issues:create"],
        token_expires_at: null,
        deleted_at: null,
      },
    ],
  });
  await page.getByRole("button", { name: "Connected Linear", exact: true }).click();
  await page.getByRole("button", { name: "Permissions for Linear test workspace" }).click();
  const permissions = page.getByRole("dialog", { name: "Permissions", exact: true });
  await expect(permissions.getByRole("button", { name: "Read only" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await permissions.getByRole("button", { name: "Read and write" }).click();
  await permissions.getByLabel(/Linear team UUID/u).fill(teamId);
  await permissions.getByLabel("Issue title").fill("Review integration");
  await permissions.getByLabel("Issue description").fill("Fixture issue details");
  await permissions.getByRole("button", { name: "Review issue" }).click();
  await expect(permissions.getByText(`Linear team ${teamId}`)).toBeVisible();
  const writes = () =>
    page.evaluate(() =>
      (window as FixtureWindow).operations.filter(([kind]) => kind === "create-linear-issue"),
    );
  expect(await writes()).toEqual([]);
  await permissions.getByRole("button", { name: "Create issue" }).click();
  await expect(permissions.getByText("Issue created in Linear.")).toBeVisible();
  expect(await writes()).toEqual([
    [
      "create-linear-issue",
      {
        target: accountId,
        teamId,
        title: "Review integration",
        description: "Fixture issue details",
        confirmed: true,
      },
    ],
  ]);
});

test("Google Drive grants folder creation per account only after review", async ({ page }) => {
  const writableGoogle = {
    ...healthyGoogle,
    accounts: healthyGoogle.accounts?.map((account) => ({
      ...account,
      has: { ...healthyGoogle.has!, driveWrite: true },
    })),
  };
  await boot(page, writableGoogle);
  await page.getByRole("button", { name: "Connected Google Drive", exact: true }).click();
  await page.getByRole("button", { name: "Permissions for connected@example.test" }).click();
  const permissions = page.getByRole("dialog", { name: "Permissions", exact: true });
  await permissions.getByRole("button", { name: "Read and write" }).click();
  await permissions.getByLabel("Folder name in My Drive").fill("Drive fixture folder");
  await permissions.getByRole("button", { name: "Review folder" }).click();
  expect(
    await page.evaluate(() =>
      (window as FixtureWindow).operations.some(([kind]) => kind === "drive-folder"),
    ),
  ).toBe(false);
  await permissions.getByRole("button", { name: "Create folder" }).click();
  await expect(permissions.getByText("Folder created in Google Drive.")).toBeVisible();
  expect(await page.evaluate(() => (window as FixtureWindow).operations.at(-1))).toEqual([
    "drive-folder",
    { target: "account-1", name: "Drive fixture folder" },
  ]);
});

test("Outlook asks for a separate send grant and reviews message contents", async ({ page }) => {
  const account = {
    id: "11111111-1111-4111-8111-111111111111",
    provider_id: "microsoft",
    account_label: "Mail fixture",
    status: "connected",
    token_expires_at: null,
  };
  for (const hasSendGrant of [false, true]) {
    await boot(page, emptyGoogle, undefined, {
      configuredProviders: [{ id: "microsoft" }],
      accounts: [
        {
          ...account,
          granted_scopes: hasSendGrant ? ["Mail.ReadWrite", "Mail.Send"] : ["Mail.ReadWrite"],
        },
      ],
    });
    await page.getByRole("button", { name: "Connected Outlook", exact: true }).click();
    await page.getByRole("button", { name: "Permissions for Mail fixture" }).click();
    const permissions = page.getByRole("dialog", { name: "Permissions", exact: true });
    await permissions.getByRole("button", { name: "Read and write" }).click();
    await permissions.getByLabel("Recipient").fill("fixture@example.test");
    await permissions.getByLabel("Subject").fill("Fixture subject");
    await permissions.getByLabel("Message", { exact: true }).fill("Fixture body");
    await permissions.getByRole("button", { name: "Review draft" }).click();
    await expect(permissions.getByText("To fixture@example.test")).toBeVisible();
    const send = permissions.getByRole("button", { name: "Send Outlook message" });
    const operations = () => page.evaluate(() => (window as FixtureWindow).operations);
    expect((await operations()).some(([kind]) => kind === "send-outlook")).toBe(false);
    if (!hasSendGrant) {
      await expect(send).toHaveCount(0);
      await permissions.getByRole("button", { name: "Authorize sending with Outlook" }).click();
      const start = (await operations()).find(([kind]) => kind === "provider-request");
      expect(JSON.parse((start?.[2] as RequestInit).body as string).optionalScopes).toEqual([
        "Mail.Read",
        "Mail.Send",
      ]);
      continue;
    }
    await send.click();
    await expect(permissions.getByText("Outlook accepted the message for sending.")).toBeVisible();
    expect((await operations()).at(-1)).toEqual([
      "send-outlook",
      {
        target: account.id,
        recipient: "fixture@example.test",
        subject: "Fixture subject",
        body: "Fixture body",
        confirmed: true,
      },
    ]);
  }
});

test("new master entries show the correct native and OAuth setup requirements", async ({
  page,
}) => {
  await boot(page);
  const search = page.getByRole("textbox", { name: "Search connections" });
  for (const [query, id] of [
    ["IBKR", "interactive-brokers"],
    ["Outlook Mail", "outlook"],
    ["bring your own server", "custom-mcp"],
    ["HealthKit", "apple-health"],
  ]) {
    await search.fill(query);
    await expect(page.locator("[data-plugin-id]")).toHaveCount(1);
    await expect(page.locator(`[data-plugin-id="${id}"]`)).toBeVisible();
  }
  await page.getByRole("link", { name: "Apple Health", exact: true }).click();
  await expect(page.getByRole("article")).toContainText("Native app required");
  await expect(page.getByRole("article")).toContainText("signed iPhone app");
  await expect(page.getByRole("article")).toContainText("separate device permissions");
  await expect(
    page.getByRole("article").getByRole("button", { name: "Connect", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Back to Connections" }).click();
  await search.fill("HubSpot");
  await expect(page.locator("[data-plugin-id]")).toHaveCount(0);
  expect(await page.evaluate(() => (window as FixtureWindow).operations)).toEqual([]);
});

test("Free accounts cannot initiate Gmail OAuth", async ({ page }) => {
  await boot(page);
  await page.getByRole("button", { name: "Connect Gmail", exact: true }).click();
  await expect(
    page.getByRole("article").getByRole("button", { name: "Connect", exact: true }),
  ).toBeDisabled();
  expect(await page.evaluate(() => (window as FixtureWindow).operations)).toEqual([]);
});

test("opening and leaving a connector page never starts OAuth; Connect is explicit", async ({
  page,
}) => {
  await boot(page, undefined, undefined, undefined, "plus");
  const trigger = page.getByRole("link", { name: "Gmail", exact: true });
  await trigger.click();
  await expect(page).toHaveURL(/\/apps\?plugin=gmail$/u);
  await expect(page.getByRole("heading", { level: 1, name: "Gmail" })).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const permissions = page.getByRole("tabpanel", { name: "Permissions", exact: true });
  await expect(permissions).toContainText("Capabilities and permissions");
  await expect(permissions).toContainText("Google’s consent screen");
  expect(await page.evaluate(() => (window as FixtureWindow).operations)).toEqual([]);
  await page.getByRole("button", { name: "Back to Connections" }).click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  const heroConnect = page
    .getByRole("article")
    .locator("header")
    .getByRole("button", { name: "Connect", exact: true });
  await expect(heroConnect).toBeEnabled();
  await heroConnect.click();
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).operations.length)).toBe(1);
  expect((await page.evaluate(() => (window as FixtureWindow).operations))[0][0]).toBe(
    "google-connect",
  );
});

test("unavailable providers have readable details and no connection action", async ({ page }) => {
  await boot(page);
  await page.getByRole("link", { name: "Slack", exact: true }).click();
  await expect(
    page.locator(".kova-connection-hero").getByText("Coming soon", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("article").getByRole("button", { name: "Connect", exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => (window as FixtureWindow).operations)).toEqual([]);
});

test("connector page fields and example panel use the flat Claude-style layout", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await boot(page, emptyGoogle, "https://kova-plugins.test/apps?plugin=custom-mcp", {
    configuredProviders: [{ id: "custom-mcp" }],
    accounts: [],
  });

  await expect(page.getByLabel("Approved server ID")).toHaveCSS("margin-block-start", "2px");
  await expect(page.getByLabel("MCP bearer token")).toHaveCSS("margin-block-start", "2px");
});

test("Manage shows verified account scopes and confirms a disconnect with workflow impact", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await boot(page, healthyGoogle);
  await page.getByRole("button", { name: "Connected Gmail", exact: true }).click();
  const connector = page.getByRole("article");
  await expect(connector).toContainText("connected@example.test");
  await expect(connector.getByRole("heading", { name: "Current permission scope" })).toBeVisible();
  await expect(connector.getByText("gmail.readonly", { exact: true })).toBeVisible();
  await expect(connector.locator(".spec400-plugin-scope-list summary")).toHaveCount(0);
  const setup = connector.getByRole("region", { name: "Connector setup" });
  await expect(setup).toBeVisible();
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
  await expect(page.getByRole("article")).toContainText("No Google accounts are connected");
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

test("the list and full connector page fit the phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const frame = await page.locator(".spec400-plugin-logo").first().boundingBox();
  expect(frame).not.toBeNull();
  expect(frame!.width).toBe(frame!.height);
  expect(frame!.width).toBeGreaterThanOrEqual(38);
  expect(frame!.width).toBeLessThanOrEqual(48);
  await page.getByRole("button", { name: "Connect Gmail", exact: true }).click();
  const panel = await page.getByRole("article").boundingBox();
  expect(panel).not.toBeNull();
  expect(panel!.x).toBeGreaterThanOrEqual(11);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(379);
  expect(panel!.y).toBeGreaterThanOrEqual(0);
  expect(panel!.height).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "Back to Connections" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the first and last selected connection tabs have even outer insets", async ({ page }) => {
  await boot(page);
  const tabs = page.getByRole("tablist", { name: "Connections" });
  for (const name of ["All", "Finances"]) {
    await tabs.getByRole("tab", { name, exact: true }).click();
    const outer = (await tabs.boundingBox())!;
    const selected = (await tabs.getByRole("tab", { name, exact: true }).boundingBox())!;
    const top = selected.y - outer.y;
    const bottom = outer.y + outer.height - selected.y - selected.height;
    const outerSide =
      name === "All" ? selected.x - outer.x : outer.x + outer.width - selected.x - selected.width;
    expect(top).toBeGreaterThan(0);
    expect(Math.abs(top - bottom)).toBeLessThan(1);
    expect(Math.abs(top - outerSide)).toBeLessThan(1);
  }
});

test("connector title links, deep links and browser history restore the directory", async ({
  page,
}) => {
  await boot(page);
  const search = page.getByRole("textbox", { name: "Search connections" });
  await search.fill("Canva");
  const link = page.getByRole("link", { name: "Canva", exact: true });
  await link.click();
  await expect(page).toHaveURL(/\/apps\?plugin=canva$/u);
  await expect(page.getByRole("article", { name: "Canva" })).toBeVisible();
  await page.goBack();
  await expect(search).toHaveValue("Canva");
  await expect(link).toBeFocused();
  await page.goForward();
  await expect(page.getByRole("article", { name: "Canva" })).toBeVisible();
  // Release the first document before a cold deep-link load; WebKit can crash on a reboot over a live page.
  await page.goto("about:blank");
  await boot(page, emptyGoogle, "https://kova-plugins.test/apps?plugin=github");
  await expect(page.getByRole("article", { name: "GitHub" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => (window as FixtureWindow).operations)).toEqual([]);
});

test("all connectors have custom overviews and working permissions pages", async ({ page }) => {
  test.setTimeout(60_000);
  await boot(page);
  const descriptions = new Set<string>();
  const examples = new Set<string>();
  for (const { id } of MASTER_CONNECTORS) {
    const row = page.locator(`[data-plugin-id="${id}"]`);
    await row.getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/apps\\?plugin=${id}$`, "u"));
    const detail = page.getByRole("article");
    const overview = detail.getByRole("tabpanel", { name: "Overview", exact: true });
    const description = await overview.locator(".kova-connection-overview").innerText();
    const example = await overview.locator(".kova-connection-prompt").first().innerText();
    expect(description).toBeTruthy();
    expect(example).toBeTruthy();
    descriptions.add(description);
    examples.add(example);
    await expect(detail.getByText("Developer", { exact: true })).toBeVisible();
    await expect(detail.getByRole("heading", { name: "Related connections" })).toBeVisible();
    const permissions = detail.getByRole("tabpanel", { name: "Permissions", exact: true });
    await expect(permissions.getByRole("heading", { name: "Read access" })).toBeVisible();
    if (["oura", "sp-global", "interactive-brokers"].includes(id))
      await expect(permissions.getByRole("heading", { name: "Optional write access" })).toHaveCount(
        0,
      );
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await detail.getByRole("button", { name: "Back to Connections" }).click();
  }
  expect(descriptions.size).toBe(MASTER_CONNECTORS.length);
  expect(examples.size).toBe(MASTER_CONNECTORS.length);
  expect(await page.evaluate(() => (window as FixtureWindow).operations)).toEqual([]);
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
  await page.getByRole("button", { name: "Connected Outlook", exact: true }).click();
  const dialog = page.getByRole("article");
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

test("Outlook Calendar reuses only a calendar-authorized account and requests read access explicitly", async ({
  page,
}) => {
  const mailId = "11111111-1111-4111-8111-111111111111";
  const calendarId = "22222222-2222-4222-8222-222222222222";
  await boot(page, emptyGoogle, "https://kova-plugins.test/apps", {
    configuredProviders: [{ id: "microsoft" }],
    accounts: [
      {
        id: mailId,
        provider_id: "microsoft",
        account_label: "mail-only@example.test",
        status: "connected",
        granted_scopes: ["Mail.Read"],
        token_expires_at: null,
      },
      {
        id: calendarId,
        provider_id: "microsoft",
        account_label: "calendar@example.test",
        status: "connected",
        granted_scopes: ["Calendars.ReadWrite"],
        token_expires_at: null,
      },
    ],
  });
  await page.getByRole("button", { name: "Connected Outlook Calendar", exact: true }).click();
  const dialog = page.getByRole("article");
  await expect(dialog).toContainText("subject starts with");
  expect(await page.evaluate(() => (window as FixtureWindow).operations)).toEqual([]);
  await dialog
    .getByRole("textbox", { name: "Search Outlook Calendar", exact: true })
    .fill("Meeting");
  const mail = dialog.getByRole("listitem").filter({ hasText: "mail-only@example.test" });
  const calendar = dialog.getByRole("listitem").filter({ hasText: "calendar@example.test" });
  await expect(
    mail.getByRole("button", { name: "Search this account", exact: true }),
  ).toBeDisabled();
  await calendar.getByRole("button", { name: "Search this account", exact: true }).click();
  expect((await page.evaluate(() => (window as FixtureWindow).operations))[0]).toEqual([
    "provider-read",
    { connectionId: "outlook-calendar", accountId: calendarId, query: "Meeting" },
  ]);
  await expect(dialog.getByText("Read access verified for this request.")).toBeVisible();
  await page.evaluate(() => {
    (window as FixtureWindow).readError =
      "Microsoft could not find a default calendar for this account.";
  });
  await calendar.getByRole("button", { name: "Search this account", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Microsoft could not find a default calendar for this account.",
  );
  await expect(dialog.getByText("Read access verified for this request.")).toHaveCount(0);
  await mail.getByRole("button", { name: "Reconnect or add read access", exact: true }).click();
  const operations = await page.evaluate(() => (window as FixtureWindow).operations);
  expect(operations).toHaveLength(3);
  expect(operations[2][0]).toBe("provider-request");
  const init = operations[2][2] as { body: string };
  expect(JSON.parse(init.body)).toEqual({
    provider: "microsoft",
    optionalScopes: ["Calendars.Read"],
    returnPath: "/apps?connection_view=outlook-calendar",
    existingAccountId: mailId,
  });
});

test("Outlook Calendar shows the event times before it writes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page, emptyGoogle, undefined, {
    configuredProviders: [
      {
        id: "microsoft",
        name: "Microsoft",
        requiredScopes: [],
        optionalScopes: ["Calendars.ReadWrite"],
      },
    ],
    accounts: [
      {
        id: "fixture-calendar",
        provider_id: "microsoft",
        account_label: "Calendar test account",
        status: "connected",
        granted_scopes: ["Calendars.ReadWrite"],
        token_expires_at: null,
        deleted_at: null,
      },
    ],
  });
  await page.getByRole("button", { name: "Connected Outlook Calendar", exact: true }).click();
  await page.getByRole("button", { name: "Permissions for Calendar test account" }).click();
  const permissions = page.getByRole("dialog", { name: "Permissions", exact: true });
  await permissions.getByRole("button", { name: "Read and write" }).click();
  await permissions.getByLabel("Event title").fill("Calendar fixture event");
  await permissions.getByLabel("Start (UTC)").fill("2026-11-24T14:00");
  await permissions.getByLabel("End (UTC)").fill("2026-11-24T14:30");
  await permissions.getByRole("button", { name: "Review event" }).click();
  await expect(permissions.getByText("2026-11-24 14:00 to 2026-11-24 14:30 UTC")).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as FixtureWindow).operations.some(([kind]) => kind === "create-event"),
    ),
  ).toBe(false);
  await permissions.getByRole("button", { name: "Create event" }).click();
  await expect(permissions.getByText("Event created in Outlook Calendar.")).toBeVisible();
  expect(await page.evaluate(() => (window as FixtureWindow).operations.at(-1))).toEqual([
    "create-event",
    expect.objectContaining({
      target: "fixture-calendar",
      title: "Calendar fixture event",
      start: "2026-11-24T14:00:00Z",
      end: "2026-11-24T14:30:00Z",
      actionId: expect.any(String),
    }),
  ]);
});

test("Notion can read a linked page without a public OAuth app", async ({ page }) => {
  await boot(page, emptyGoogle, "https://kova-plugins.test/apps", {
    configuredProviders: [{ id: "notion-private" }],
    accounts: [
      {
        id: "linked-page-account",
        provider_id: "notion-private",
        status: "connected",
        granted_scopes: ["page:read"],
        account_label: "Notion linked page",
        token_expires_at: null,
        deleted_at: null,
      },
    ],
  });
  await page.getByRole("button", { name: "Connected Notion", exact: true }).click();
  const dialog = page.getByRole("article", { name: "Notion", exact: true });
  await expect(dialog.getByLabel("Notion page ID", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Notion internal integration token")).toHaveAttribute(
    "type",
    "password",
  );
  await dialog.getByRole("button", { name: "Read linked page", exact: true }).click();
  await expect(dialog.getByText("Actual fixture result")).toBeVisible();
  expect(await page.evaluate(() => (window as FixtureWindow).operations)).toContainEqual([
    "provider-read",
    { connectionId: "notion-private", accountId: "linked-page-account", query: "open" },
  ]);
});

test("Salesforce management sends the selected record type with the owner-bound account", async ({
  page,
}) => {
  await boot(page, emptyGoogle, "https://kova-plugins.test/apps", {
    configuredProviders: [{ id: "salesforce" }],
    accounts: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        provider_id: "salesforce",
        account_label: "Salesforce fixture",
        status: "connected",
        granted_scopes: ["api", "openid", "refresh_token"],
        token_expires_at: null,
      },
    ],
  });
  await page.getByRole("button", { name: "Connected Salesforce", exact: true }).click();
  const dialog = page.getByRole("article");
  await dialog.getByRole("combobox", { name: "Record type", exact: true }).click();
  await page.getByRole("option", { name: "Opportunities", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Search Salesforce", exact: true }).fill("renewal");
  await dialog.getByRole("button", { name: "Search this account", exact: true }).click();
  await expect(
    dialog.getByRole("link", { name: "Actual fixture result", exact: true }),
  ).toBeVisible();
  expect((await page.evaluate(() => (window as FixtureWindow).operations))[0]).toEqual([
    "provider-read",
    {
      connectionId: "salesforce",
      accountId: "11111111-1111-4111-8111-111111111111",
      query: "renewal",
      recordType: "opportunities",
    },
  ]);
});

test("the card Connect button starts the provider sign-in directly", async ({ page }) => {
  await boot(page, emptyGoogle, "https://kova-plugins.test/apps", {
    configuredProviders: [{ id: "microsoft" }],
    accounts: [],
  });
  await page.getByRole("link", { name: "Outlook", exact: true }).click();
  await expect(page).toHaveURL(/\/apps\?plugin=outlook$/u);
  expect(await page.evaluate(() => (window as FixtureWindow).operations)).toEqual([]);
  await page.getByRole("button", { name: "Back to Connections" }).click();
  await page.getByRole("button", { name: "Connect Outlook", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).operations.length)).toBe(1);
  const operation = (await page.evaluate(() => (window as FixtureWindow).operations))[0];
  expect(operation[1]).toBe("/api/integrations/oauth/start");
  const body = JSON.parse((operation[2] as { body: string }).body);
  expect(body.provider).toBe("microsoft");
  expect(body.optionalScopes).toEqual(["Mail.Read"]);
});
