import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { existsSync } from "node:fs";
if (process.env.KOVA_TEST_CHROMIUM_EXECUTABLE)
  test.use({ launchOptions: { executablePath: process.env.KOVA_TEST_CHROMIUM_EXECUTABLE } });
const root = process.cwd();
const mocks: Record<string, string> = {
  "@tanstack/react-start": "export const createClientOnlyFn=fn=>fn;",
  "@/lib/auth-fetch": `export const fetchWithTimeoutAuthenticated=async(url,init={})=>{
    const body=init.body?JSON.parse(init.body):null;
    if(url==='/api/finances/manage'&&!body)return Response.json(window.financeStatus);
    window.operations.push([url,body,init.headers['X-Kova-Expected-Owner']]);
    if(url==='/api/finances/link-token')return Response.json({link_token:'link-production-fixture',expiration:new Date(Date.now()+600000).toISOString()});
    if(url==='/api/finances/exchange'){window.financeStatus.connections=[{id:'00000000-0000-4000-8000-000000000004',status:'connected'}];return Response.json({id:'00000000-0000-4000-8000-000000000004'},{status:201})}
    if(url==='/api/finances/manage'&&body.action==='disconnect'){window.financeStatus.connections=[];return Response.json({disconnected:true})}
    if(url==='/api/finances/manage'&&body.action==='read'){
      if(window.delayRead)return new Promise(resolve=>window.resolveRead=()=>resolve(Response.json(window.financeSnapshot)));
      return Response.json(window.financeSnapshot);
    }
    if(url==='/api/health-data/read')return Response.json({provider:'oura',fetchedAt:new Date().toISOString(),summaries:[{metric:'sleep',date:'2026-10-30',score:87,scoreUnit:'score',steps:null,restingHeartRate:null}],missing:[],limited:false});
    if(url.endsWith('/disconnect')){window.healthStatus.accounts=[];return Response.json({providerRevoked:true})}
    return Response.json({error:'unavailable'},{status:503});
  };`,
};
const bundled = await build({
  stdin: {
    contents: `import React from'react';import{createRoot}from'react-dom/client';import{BankConnectionsPanel}from'./src/components/BankConnectionsPanel';import{HealthConnectionsPanel}from'./src/components/HealthConnectionsPanel';const root=createRoot(document.getElementById('root'));window.renderPanels=()=>root.render(<><BankConnectionsPanel key={'bank:'+window.owner} ownerId={window.owner}/><HealthConnectionsPanel key={'health:'+window.owner} ownerId={window.owner} data={window.healthStatus} loading={false} error={false} reload={async()=>{window.renderPanels();return true}}/></>);window.renderPanels();`,
    resolveDir: root,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  outfile: "fixture.js",
  plugins: [
    {
      name: "offline-finance-health",
      setup(builder) {
        builder.onResolve({ filter: /^@\// }, (args) =>
          mocks[args.path]
            ? { path: args.path, namespace: "fixture" }
            : {
                path: ["", ".ts", ".tsx", ".mjs"]
                  .map((ext) => path.join(root, "src", args.path.slice(2)) + ext)
                  .find(existsSync)!,
              },
        );
        builder.onResolve({ filter: /^@tanstack\/react-start$/ }, (args) => ({
          path: args.path,
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: mocks[args.path],
          loader: "tsx",
          resolveDir: root,
        }));
      },
    },
  ],
});
const script = bundled.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
type StateWindow = Window & {
  operations: unknown[][];
  finishLink: (token?: string) => void;
  owner: string | null;
  renderPanels: () => void;
  resolveRead: () => void;
  delayRead: boolean;
};
async function boot(
  page: import("@playwright/test").Page,
  options: { health?: boolean; configured?: boolean; connection?: boolean } = {},
) {
  await page.route("**/*", (route) =>
    route.request().url().startsWith("https://kova-sensitive-fixture.test/")
      ? route.fulfill({
          contentType: "text/html",
          body: "<!doctype html><html><head></head><body><div id='root'></div></body></html>",
        })
      : route.abort(),
  );
  await page.goto("https://kova-sensitive-fixture.test/apps");
  await page.evaluate(({ health, configured, connection }) => {
    Object.assign(window, {
      owner: "00000000-0000-4000-8000-000000000001",
      operations: [],
      financeStatus: {
        configured: configured !== false,
        planEligible: true,
        connections: connection
          ? [{ id: "00000000-0000-4000-8000-000000000004", status: "connected" }]
          : [],
      },
      financeSnapshot: {
        fetchedAt: new Date().toISOString(),
        accounts: [
          {
            id: "account-a",
            name: "Fixture checking",
            current: 120,
            available: 100,
            currency: "USD",
          },
        ],
        transactions: [
          {
            id: "transaction-a",
            name: "Fixture coffee",
            date: "2026-10-30",
            amount: 5,
            currency: "USD",
          },
        ],
        limited: false,
      },
      healthStatus: {
        configuredProviders: health ? [{ id: "oura" }] : [],
        accounts: health
          ? [
              {
                id: "00000000-0000-4000-8000-000000000003",
                provider_id: "oura",
                status: "connected",
                granted_scopes: ["daily"],
              },
            ]
          : [],
      },
      Plaid: {
        create: (options: { token: string; onSuccess: (token: string) => void }) => {
          (window as StateWindow).finishLink = (token = "public-production-fixture") =>
            options.onSuccess(token);
          return {
            open: () => (window as StateWindow).operations.push(["sdk-open", options.token]),
            destroy: () => {},
          };
        },
      },
    });
  }, options);
  await page.addStyleTag({
    content:
      "*{box-sizing:border-box}body{font:16px Arial;margin:24px}button{padding:10px;margin:4px}table{width:100%}td,th{padding:8px;text-align:left}[role=alertdialog]{position:fixed;inset:15%;background:white;border:1px solid;padding:20px}",
  });
  await page.addScriptTag({ content: script });
  await expect(page.getByRole("heading", { name: "Bank accounts" })).toBeVisible();
}

test("bank Link is explicit and exchanges one public token after successful consent", async ({
  page,
}) => {
  await boot(page);
  expect(await page.evaluate(() => (window as StateWindow).operations)).toEqual([]);
  await page.getByRole("button", { name: "Connect bank", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as StateWindow).operations.length)).toBe(2);
  await page.evaluate(() => {
    (window as StateWindow).finishLink();
    (window as StateWindow).finishLink();
  });
  await expect(page.getByText(/Bank connected\. Choose/)).toBeVisible();
  const operations = await page.evaluate(() => (window as StateWindow).operations);
  expect(operations.filter((operation) => operation[0] === "/api/finances/exchange")).toHaveLength(
    1,
  );
  expect(operations.find((operation) => operation[0] === "/api/finances/exchange")?.[2]).toBe(
    "00000000-0000-4000-8000-000000000001",
  );
  await page.getByRole("button", { name: "Read balances and transactions" }).click();
  await expect(page.getByText("Fixture checking")).toBeVisible();
  await expect(page.getByText("Fixture coffee")).toBeVisible();
  await page.getByRole("button", { name: "Disconnect bank 1" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    (await page.evaluate(() => (window as StateWindow).operations)).filter(
      (operation) => (operation[1] as { action?: string })?.action === "disconnect",
    ),
  ).toHaveLength(0);
});
test("unconfigured finance and health stay disabled and never fetch private data", async ({
  page,
}) => {
  await boot(page, { configured: false });
  await expect(page.getByRole("button", { name: "Connect bank", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Connect Oura", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Connect WHOOP", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as StateWindow).operations)).toEqual([]);
});
test("health summaries load only after the user selects an account read", async ({ page }) => {
  await boot(page, { health: true });
  expect(await page.evaluate(() => (window as StateWindow).operations)).toEqual([]);
  await page.getByRole("button", { name: "Read Oura summaries" }).click();
  await expect(page.getByText("87 score", { exact: true })).toBeVisible();
  const operations = await page.evaluate(() => (window as StateWindow).operations);
  expect(operations).toEqual([
    [
      "/api/health-data/read",
      { accountId: "00000000-0000-4000-8000-000000000003" },
      "00000000-0000-4000-8000-000000000001",
    ],
  ]);
});
test("switching account hides a pending bank read", async ({ page }) => {
  await boot(page, { connection: true });
  await page.evaluate(() => {
    (window as StateWindow).delayRead = true;
  });
  await page.getByRole("button", { name: "Read balances and transactions" }).click();
  await page.evaluate(() => {
    (window as StateWindow).owner = null;
    (window as StateWindow).renderPanels();
  });
  await expect(page.getByText("Sign in to manage bank connections.")).toBeVisible();
  await page.evaluate(() => (window as StateWindow).resolveRead());
  await expect(page.getByText("Fixture checking")).toHaveCount(0);
});

test("an old Plaid success callback cannot exchange its token after account switching", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "Connect bank", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as StateWindow).operations.length)).toBe(2);
  await page.evaluate(() => {
    (window as StateWindow).owner = null;
    (window as StateWindow).renderPanels();
  });
  await expect(page.getByText("Sign in to manage bank connections.")).toBeVisible();
  await page.evaluate(() => (window as StateWindow).finishLink());
  expect(
    (await page.evaluate(() => (window as StateWindow).operations)).some(
      (operation) => operation[0] === "/api/finances/exchange",
    ),
  ).toBe(false);
});
