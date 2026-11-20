import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { statSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
if (process.env.KOVA_TEST_CHROMIUM_EXECUTABLE)
  test.use({ launchOptions: { executablePath: process.env.KOVA_TEST_CHROMIUM_EXECUTABLE } });
const root = process.cwd();
const mocks: Record<string, string> = {
  "@tanstack/react-start": "export const createClientOnlyFn=fn=>fn;",
  "@/lib/auth-fetch": `export const fetchWithTimeoutAuthenticated=async(url,init={})=>{
    const body=init.body?JSON.parse(init.body):null;
    if(url==='/api/finances/manage'&&!body){
      window.financeStatusRequests++;
      return Response.json(window.financeStatus);
    }
    const ownerHeader=url.startsWith('/api/finances/')?'X-Kova-Owner':'X-Kova-Expected-Owner';
    window.operations.push([url,body,init.headers[ownerHeader]]);
    if(url==='/api/finances/link-token')return Response.json({link_token:'link-production-fixture',expiration:new Date(Date.now()+600000).toISOString()});
    if(url==='/api/finances/exchange'){window.financeStatus.connections=[{id:'00000000-0000-4000-8000-000000000004',status:'connected'}];return Response.json({id:'00000000-0000-4000-8000-000000000004'},{status:201})}
    if(url==='/api/finances/manage'&&body.action==='disconnect'){window.financeStatus.connections=[];return Response.json({disconnected:true})}
    if(url==='/api/finances/manage'&&body.action==='read'){
      if(window.delayRead)return new Promise(resolve=>window.resolveRead=()=>resolve(Response.json(window.financeSnapshot)));
      return Response.json(window.financeSnapshot);
    }
    if(url==='/api/health-data/read')return Response.json({asOf:'2026-11-20',fetchedAt:new Date().toISOString(),metrics:{'daily_sleep.score':[{name:'Oura',days:[{date:'2026-11-20',value:87}]}]},missing:[],unavailable:[],limited:false});
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
                  .find((candidate) => statSync(candidate, { throwIfNoEntry: false })?.isFile())!,
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
  financeStatusRequests: number;
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
      financeStatusRequests: 0,
      financeStatus: {
        configured: configured !== false,
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
            category: "FOOD_AND_DRINK",
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
      "*{box-sizing:border-box}body{font:16px Arial;margin:24px}.hidden{display:none}div[role=img]{height:256px}button{padding:10px;margin:4px}table{width:100%}td,th{padding:8px;text-align:left}[role=alertdialog]{position:fixed;inset:15%;background:white;border:1px solid;padding:20px}",
  });
  await page.addScriptTag({ content: script });
  await expect
    .poll(() => page.evaluate(() => (window as StateWindow).financeStatusRequests))
    .toBe(1);
  await expect(
    page.getByRole("heading", { name: options.connection ? "Accounts linked" : "Spending" }),
  ).toBeVisible();
}

test("bank Link is explicit and exchanges one public token after successful consent", async ({
  page,
}) => {
  await boot(page);
  await expect(page.getByRole("heading", { name: "Bank accounts" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh bank status" })).toHaveCount(0);
  await expect(page.getByText("Read-only connections")).toHaveCount(0);
  expect(await page.evaluate(() => (window as StateWindow).operations)).toEqual([]);
  await page.getByRole("button", { name: "Connect a bank", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as StateWindow).operations.length)).toBe(2);
  await page.evaluate(() => {
    (window as StateWindow).finishLink();
    (window as StateWindow).finishLink();
  });
  await expect(page.getByRole("heading", { name: "Accounts linked", exact: true })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Spending" }).getByText("Sample data", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Daily cash flow/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /Spending by category/ })).toBeVisible();
  await expect(page.getByText("Food and drink", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: /Daily cash flow/ }).locator("svg")).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Spending by category/ }).locator("svg"),
  ).toBeVisible();
  const operations = await page.evaluate(() => (window as StateWindow).operations);
  expect(operations.filter((operation) => operation[0] === "/api/finances/exchange")).toHaveLength(
    1,
  );
  expect(operations.find((operation) => operation[0] === "/api/finances/exchange")?.[2]).toBe(
    "00000000-0000-4000-8000-000000000001",
  );
  await expect(page.getByText("Fixture checking")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Fixture coffee", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Disconnect bank 1" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    (await page.evaluate(() => (window as StateWindow).operations)).filter(
      (operation) => (operation[1] as { action?: string })?.action === "disconnect",
    ),
  ).toHaveLength(0);
});
test("the Connections Health tab opens an Apple Health ZIP locally for the signed-in owner", async ({
  page,
}) => {
  await boot(page);
  const health = page.getByRole("region", { name: "A new way to manage your health", exact: true });
  await expect(health.getByText("Sample data", { exact: true })).toHaveCount(0);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const zip = zipSync({
    "apple_health_export/export.xml": strToU8(`<HealthData>
      <ExportDate value="2026-11-20 12:00:00 -0500"/>
      <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Watch" unit="count" startDate="2026-11-20 10:00:00 -0500" value="123"/>
      <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Phone" unit="count" startDate="2026-11-20 10:00:00 -0500" value="789"/>
      <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Watch" unit="count/min" startDate="2026-11-01 10:00:00 -0500" value="68"/>
    </HealthData>`),
  });
  const region = page.getByRole("region", { name: "Apple Health", exact: true });
  const input = region.getByRole("button", { name: "Import Apple Health data" });
  await expect(input).toBeHidden();
  await page.getByText("Manage health connections", { exact: true }).click();
  await region.getByText("Connection options", { exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await input.click();
  await (
    await chooser
  ).setFiles({
    name: "export.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(zip),
  });
  const source = health.getByLabel("Step source");
  await health.getByText(/^Daily readings/).click();
  await expect(health.getByRole("cell", { name: "789", exact: true })).toBeVisible();
  await source.selectOption({ label: "Watch" });
  await expect(health.getByRole("cell", { name: "123", exact: true })).toBeVisible();
  await expect(health.getByRole("cell", { name: "789", exact: true })).toHaveCount(0);
  await health.getByRole("tab", { name: "Vitals", exact: true }).click();
  await expect(
    health.getByText("No readings for this source in the selected range."),
  ).toBeVisible();
  await health.getByRole("slider", { name: "Date range" }).press("End");
  await health.getByText(/^Daily readings/).click();
  await expect(health.getByRole("cell", { name: "68", exact: true })).toBeVisible();
  expect(requests).toEqual([]);

  await page.evaluate(() => {
    const state = window as StateWindow;
    state.owner = "00000000-0000-4000-8000-000000000006";
    state.renderPanels();
  });
  await expect(health.getByRole("table")).toHaveCount(0);
  await page.evaluate(() => {
    const state = window as StateWindow;
    state.owner = null;
    state.renderPanels();
  });
  await expect(input).toHaveCount(0);
});

test("native Apple Health updates refresh the chart only during the active connection", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const messages: { action: string; id: string }[] = [];
    Object.assign(window, { healthBridgeMessages: messages });
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: {
        messageHandlers: {
          kovaHealth: { postMessage: (value: (typeof messages)[number]) => messages.push(value) },
        },
      },
    });
  });
  await boot(page);
  const health = page.getByRole("region", { name: "A new way to manage your health", exact: true });
  const region = page.getByRole("region", { name: "Apple Health", exact: true });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { healthBridgeMessages?: { action: string }[] })
            .healthBridgeMessages?.[0]?.action,
      ),
    )
    .toBe("resume");
  const push = (value: number, current: boolean) =>
    page.evaluate(
      ({ value, current }) => {
        const { healthBridgeMessages } = window as Window & {
          healthBridgeMessages?: { id: string }[];
        };
        window.dispatchEvent(
          new CustomEvent("kova-health-update-v1", {
            detail: {
              id: current ? healthBridgeMessages?.[0]?.id : "wrong-connection",
              report: {
                asOf: "2026-11-20",
                metrics: { StepCount: [{ date: "2026-11-20", value }] },
              },
            },
          }),
        );
      },
      { value, current },
    );
  await push(300, false);
  await expect(health.getByText("300 steps", { exact: true })).toHaveCount(0);
  await push(300, true);
  await expect(health.getByText("300 steps", { exact: true }).first()).toBeVisible();
  await push(320, true);
  await expect(health.getByText("320 steps", { exact: true }).first()).toBeVisible();
  await page.getByText("Manage health connections", { exact: true }).click();
  await region.getByText("Connection options", { exact: true }).click();
  await region.getByRole("button", { name: "Disconnect Apple Health" }).click();
  await push(321, true);
  await expect(health.getByText("321 steps", { exact: true })).toHaveCount(0);
  await expect(health.getByText("320 steps", { exact: true })).toHaveCount(0);
});

test("unconfigured finance and health stay disabled and never fetch private data", async ({
  page,
}) => {
  await boot(page, { configured: false });
  await expect(
    page.getByRole("region", { name: "Spending" }).getByText("Sample data", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect a bank", exact: true })).toHaveCount(0);
  await expect(page.getByRole("banner").getByText("Coming soon", { exact: true })).toBeVisible();
  await page.getByText("Manage health connections", { exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Oura", exact: true }).getByText("Coming soon"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Oura", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect WHOOP", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as StateWindow).operations)).toEqual([]);
});
test("Oura refreshes automatically in the unified health dashboard", async ({ page }) => {
  await boot(page, { health: true });
  await expect(page.getByRole("tab", { name: "Oura", exact: true })).toHaveCount(0);
  await expect(page.getByText("87 score", { exact: true }).first()).toBeVisible();
  const operations = await page.evaluate(() => (window as StateWindow).operations);
  expect(operations).toEqual([
    [
      "/api/health-data/read",
      { accountId: "00000000-0000-4000-8000-000000000003", mode: "analytics" },
      "00000000-0000-4000-8000-000000000001",
    ],
  ]);
});
test("switching account hides a pending bank read", async ({ page }) => {
  await boot(page, { connection: true });
  await expect(page.getByText("Fixture checking")).toBeVisible();
  await page.evaluate(() => {
    (window as StateWindow).delayRead = true;
  });
  await page.getByRole("button", { name: "Refresh balances and transactions" }).click();
  await page.evaluate(() => {
    (window as StateWindow).owner = null;
    (window as StateWindow).renderPanels();
  });
  await expect(page.getByRole("button", { name: "Connect a bank", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Spending" }).getByText("Sample data", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => (window as StateWindow).resolveRead());
  await expect(page.getByText("Fixture checking")).toHaveCount(0);
});

test("an old Plaid success callback cannot exchange its token after account switching", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "Connect a bank", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as StateWindow).operations.length)).toBe(2);
  await page.evaluate(() => {
    (window as StateWindow).owner = null;
    (window as StateWindow).renderPanels();
  });
  await expect(page.getByRole("button", { name: "Connect a bank", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Spending" }).getByText("Sample data", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => (window as StateWindow).finishLink());
  expect(
    (await page.evaluate(() => (window as StateWindow).operations)).some(
      (operation) => operation[0] === "/api/finances/exchange",
    ),
  ).toBe(false);
});
