import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mcpCanonical } from "../../src/lib/pricing/mcp-oauth-policy.mjs";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  requestId = "33333333-3333-4333-8333-333333333333",
  nextId = "44444444-4444-4444-8444-444444444444",
  projectId = "55555555-5555-4555-8555-555555555555";
let bundle = "";
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{DeveloperMcpAccessPage}from'./src/components/DeveloperMcpAccess';window.fixture={owner:'${owner}'};function Harness(){const[user,setUser]=useState('${owner}'),[request,setRequest]=useState('${requestId}');window.fixture.owner=user;window.fixture.switchUser=()=>setUser('${other}');window.fixture.switchRequest=()=>setRequest('${nextId}');window.fixture.reset=()=>window.dispatchEvent(new CustomEvent('kova:principal-browser-storage-cleared',{detail:{principal:'user:'+user}}));return <DeveloperMcpAccessPage requestId={request}/>};createRoot(document.getElementById('root')).render(<Harness/>);`,
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
        name: "fixture",
        setup(builder) {
          builder.onResolve(
            {
              filter:
                /ClerkSafe$|AuthDialog$|integrations\/supabase\/client$|^@tanstack\/react-router$/,
            },
            (args) => ({ path: args.path, namespace: "fixture" }),
          );
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            loader: "jsx",
            resolveDir: process.cwd(),
            contents: args.path.endsWith("ClerkSafe")
              ? "export const useUser=()=>({isLoaded:true,user:{id:window.fixture.owner}});"
              : args.path.endsWith("AuthDialog")
                ? "export const AuthDialog=()=>null;"
                : args.path.includes("supabase")
                  ? 'export const supabase={auth:{async getSession(){return {data:{session:{user:{id:window.fixture.owner},access_token:"fixture-token:"+window.fixture.owner}}}}}};'
                  : 'import React from "react";export const Link=({to,children,...props})=><a href={to} {...props}>{children}</a>;',
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles[0].text;
});
function details(id = requestId) {
  return {
    id,
    requestHash: "a".repeat(64),
    clientId: "66666666-6666-4666-8666-666666666666",
    clientName: id === nextId ? "Next client" : "External client",
    redirectUri: "https://client.example/callback?keep=a%20b",
    resource: "https://kova.example/mcp",
    scopes: ["chat", "files"],
    refreshAllowed: true,
    decision: null,
    expiresAt: "2026-09-06",
    projects: [
      {
        id: projectId,
        name: "Private developer project",
        currency: "USD",
        request_limit: 2,
        daily_limit: 20,
        monthly_limit: 200,
        concurrent_limit: 2,
      },
    ],
  };
}
async function mount(page: Page, { defer = false } = {}) {
  const state: {
    calls: Array<{ headers: Record<string, string>; body: Record<string, unknown> }>;
    release?: () => Promise<void>;
  } = { calls: [] };
  await page.route("https://kova.example/", (route) =>
    route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }),
  );
  await page.route("https://kova.example/api/developer/mcp*", async (route) => {
    const request = route.request();
    if (request.method() === "GET")
      return route.fulfill({
        json: details(new URL(request.url()).searchParams.get("request_id") ?? requestId),
      });
    state.calls.push({ headers: request.headers(), body: request.postDataJSON() });
    const target = new URL(details().redirectUri);
    target.searchParams.set("state", "client-state");
    target.searchParams.set("iss", "https://kova.example");
    target.searchParams.set("code", "test-code");
    const fulfill = async () => {
      try {
        await route.fulfill({ json: { redirectUri: target.href } });
      } catch {
        /* Aborted owner lifetimes discard this response. */
      }
    };
    if (defer) {
      state.release = fulfill;
      return;
    }
    await fulfill();
  });
  await page.route("https://client.example/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "Client callback" }),
  );
  await page.goto("https://kova.example/");
  await page.addScriptTag({ content: bundle });
  await expect(page.getByText("External client", { exact: false }).first()).toBeVisible();
  return state;
}
async function choices(page: Page) {
  await page.getByLabel("Developer project", { exact: true }).selectOption(projectId);
  for (const [field, value] of Object.entries({
    request: "1",
    daily: "10",
    monthly: "100",
    concurrent: "2",
  }))
    await page.getByLabel(field, { exact: true }).fill(value);
}
async function action(page: Page, name: "switchUser" | "switchRequest" | "reset") {
  await page.evaluate(
    (name) => (window as unknown as { fixture: Record<string, () => void> }).fixture[name](),
    name,
  );
}
test("consent requires explicit reviewed limits and hashes the selected scope subset for the captured owner", async ({
  page,
}) => {
  const state = await mount(page);
  const approve = page.getByRole("button", { name: "Approve connection", exact: true });
  await expect(approve).toBeDisabled();
  await choices(page);
  await page
    .getByLabel("Read and manage private developer text files in this developer project", {
      exact: true,
    })
    .uncheck();
  const review = page.getByLabel(
    "I reviewed this client, destination, developer project, permissions and spending limits.",
    { exact: true },
  );
  await expect(approve).toBeDisabled();
  await review.check();
  await page.getByLabel("daily", { exact: true }).fill("11");
  await expect(review).not.toBeChecked();
  await expect(approve).toBeDisabled();
  await review.check();
  await approve.click();
  await expect(page).toHaveURL(/https:\/\/client\.example\/callback/);
  expect(state.calls).toHaveLength(1);
  const call = state.calls[0];
  expect(call.headers["x-kova-expected-user"]).toBe(owner);
  expect(call.headers.authorization).toBe(`Bearer fixture-token:${owner}`);
  expect(call.body.scopes).toEqual(["chat"]);
  const payload = {
    requestId,
    requestHash: "a".repeat(64),
    projectId,
    scopes: ["chat"],
    limits: { request: 1, daily: 11, monthly: 100, concurrent: 2 },
  };
  expect(call.body.reviewHash).toBe(
    createHash("sha256").update(mcpCanonical(payload)).digest("hex"),
  );
});
test("switching request during a pending decision resets busy choices and discards the old redirect", async ({
  page,
}) => {
  const state = await mount(page, { defer: true });
  await choices(page);
  await page
    .getByLabel(
      "I reviewed this client, destination, developer project, permissions and spending limits.",
      { exact: true },
    )
    .check();
  await page.getByRole("button", { name: "Approve connection", exact: true }).click();
  await expect.poll(() => state.calls.length).toBe(1);
  await action(page, "switchRequest");
  await expect(
    page.getByText("Allow Next client to use developer credit?", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Deny", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Developer project", { exact: true })).toHaveValue("");
  await state.release?.();
  await expect(page).toHaveURL("https://kova.example/");
  await choices(page);
  await expect(
    page.getByLabel(
      "I reviewed this client, destination, developer project, permissions and spending limits.",
      { exact: true },
    ),
  ).not.toBeChecked();
});
test("device privacy reset aborts pending consent and removes the private request before a late response", async ({
  page,
}) => {
  const state = await mount(page, { defer: true });
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  await expect.poll(() => state.calls.length).toBe(1);
  await action(page, "reset");
  await expect(page.getByRole("status")).toContainText("Private device state was cleared");
  await state.release?.();
  await expect(page).toHaveURL("https://kova.example/");
  await expect(page.getByRole("button", { name: "Deny", exact: true })).toHaveCount(0);
});
test("an account switch unmounts pending consent and never reuses its selected project or limits", async ({
  page,
}) => {
  const state = await mount(page, { defer: true });
  await choices(page);
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  await expect.poll(() => state.calls.length).toBe(1);
  await action(page, "switchUser");
  await expect(page.getByLabel("Developer project", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Deny", exact: true })).toBeEnabled();
  await state.release?.();
  await expect(page).toHaveURL("https://kova.example/");
});
