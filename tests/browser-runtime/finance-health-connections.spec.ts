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
    if(url==='/api/finances/manage'&&body.action==='maintenance'){
      const connection=window.financeStatus.connections.find(candidate=>candidate.id===body.connectionId);
      connection.maintenanceAllowed=body.enabled;
      return Response.json({maintenanceAllowed:body.enabled});
    }
    if(url==='/api/finances/manage'&&body.action==='restore_webhook'&&body.confirmed===true)return Response.json({restored:true});
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
  options: {
    health?: boolean;
    configured?: boolean;
    readsConfigured?: boolean;
    connection?: boolean;
  } = {},
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
  await page.evaluate(({ health, configured, readsConfigured, connection }) => {
    Object.assign(window, {
      owner: "00000000-0000-4000-8000-000000000001",
      operations: [],
      financeStatusRequests: 0,
      financeStatus: {
        configured: configured !== false,
        readsConfigured: readsConfigured ?? configured !== false,
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
  await page.addInitScript(() => {
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: {
        messageHandlers: { kovaHealth: { postMessage: () => {} } },
      },
    });
  });
  await boot(page);
  const health = page.getByRole("region", { name: "A new way to manage your health", exact: true });
  await expect(health.getByText("Example data", { exact: true })).toBeVisible();
  await expect(health.getByRole("table", { name: "Daily steps" }).getByRole("row")).toHaveCount(8);
  await expect(health.getByText(/^Daily readings/)).toHaveCount(0);
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
  await expect(health.getByText(/^Daily readings/)).toHaveCount(0);
  await expect(health.getByRole("cell", { name: "789", exact: true })).toBeVisible();
  await source.selectOption({ label: "Watch" });
  await expect(health.getByRole("cell", { name: "123", exact: true })).toBeVisible();
  await expect(health.getByRole("cell", { name: "789", exact: true })).toHaveCount(0);
  await health.getByRole("tab", { name: "Vitals", exact: true }).click();
  await expect(
    health.getByText("No readings for this source in the selected range."),
  ).toBeVisible();
  await health.getByRole("slider", { name: "Date range" }).press("End");
  await expect(health.getByRole("cell", { name: "68", exact: true })).toBeVisible();
  expect(requests).toEqual([]);

  await page.evaluate(() => {
    const state = window as StateWindow;
    state.owner = "00000000-0000-4000-8000-000000000006";
    state.renderPanels();
  });
  await expect(health.getByText("Example data", { exact: true })).toBeVisible();
  await expect(health.getByRole("table", { name: "Daily steps" })).toBeVisible();
  await expect(health.getByRole("cell", { name: "123", exact: true })).toHaveCount(0);
  await expect(health.getByRole("cell", { name: "789", exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    const state = window as StateWindow;
    state.owner = null;
    state.renderPanels();
  });
  await expect(input).toHaveCount(0);
});

test("Plaid webhook restoration is gated by opt-in and explicit confirmation", async ({ page }) => {
  await boot(page, { connection: true });
  const restore = page.getByRole("button", { name: "Restore Plaid webhook" });
  await expect(restore).toHaveCount(0);
  await page.getByRole("button", { name: "Allow connection maintenance" }).click();
  await restore.click();
  const dialog = page.getByRole("alertdialog", { name: "Restore the Plaid webhook?" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  const writes = () =>
    page.evaluate(() =>
      (window as StateWindow).operations
        .map((operation) => operation[1] as { action?: string; confirmed?: boolean })
        .filter((operation) => operation?.action === "restore_webhook"),
    );
  expect(await writes()).toEqual([]);
  await restore.click();
  await dialog.getByRole("button", { name: "Restore webhook" }).click();
  await expect.poll(writes).toEqual([
    {
      connectionId: "00000000-0000-4000-8000-000000000004",
      action: "restore_webhook",
      confirmed: true,
    },
  ]);
  await page.getByRole("button", { name: "Disable connection maintenance" }).click();
  await expect(restore).toHaveCount(0);
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
  await expect(region.getByText("Record steps", { exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    const { healthBridgeMessages: messages } = window as Window & {
      healthBridgeMessages: { id: string }[];
    };
    window.dispatchEvent(
      new CustomEvent("kova-health-update-v1", {
        detail: {
          id: messages[0].id,
          canWriteSteps: true,
          report: { asOf: "2026-11-20", metrics: {} },
        },
      }),
    );
  });
  await region.getByText("Record steps", { exact: true }).click();
  await region.getByLabel("Steps", { exact: true }).fill("250");
  await region.getByLabel("Started at").fill("2026-11-20T13:00");
  await region.getByLabel("Ended at").fill("2026-11-20T13:15");
  await region.getByRole("button", { name: "Review on device" }).click();
  await expect(region.getByRole("button", { name: "Waiting for device…" })).toBeDisabled();
  await page.evaluate(() => {
    const { healthBridgeMessages: messages } = window as Window & {
      healthBridgeMessages: { action: string; id: string; count?: string }[];
    };
    const write = messages.at(-1);
    if (write?.action !== "record_steps" || write.id !== messages[0].id || write.count !== "250")
      throw new Error("The step request must be bound to the active native connection");
    window.dispatchEvent(
      new CustomEvent("kova-health-update-v1", {
        detail: { id: write.id, stepWriteState: "permission_required" },
      }),
    );
  });
  await expect(region.getByText("Allow step writing", { exact: false })).toBeVisible();
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
  await expect(page.getByText("Bank linking is currently unavailable.")).toBeVisible();
  await page.getByRole("button", { name: "Connect Health", exact: true }).click();
  const chooser = page.getByRole("dialog", { name: "Connect Health", exact: true });
  await expect(chooser.getByRole("button", { name: /Oura/ })).toBeDisabled();
  await expect(chooser.getByText("Requires iPhone app", { exact: true })).toBeVisible();
  await expect(chooser.getByText("Requires Android app", { exact: true })).toBeVisible();
  await expect(chooser.getByText("WHOOP", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect Oura", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect WHOOP", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as StateWindow).operations)).toEqual([]);
});
test("Android Health Connect confirms a native read and clears the dashboard when permission is lost", async ({
  page,
}) => {
  type HealthCommand = { action: string; id: string; owner?: string };
  await page.addInitScript(() => {
    const commands: HealthCommand[] = [];
    Object.assign(window, {
      androidHealthCommands: commands,
      kovaAndroidHealth: {
        postMessage(raw: string) {
          const message: HealthCommand = JSON.parse(raw);
          commands.push(message);
          if (message.action === "resume")
            queueMicrotask(() =>
              window.dispatchEvent(
                new CustomEvent("kova-health-update-v1", {
                  detail: { id: message.id, state: "not_connected" },
                }),
              ),
            );
        },
      },
    });
  });
  await boot(page);
  await page.getByRole("button", { name: "Connect Health", exact: true }).click();
  const choice = page
    .getByRole("dialog", { name: "Connect Health", exact: true })
    .getByRole("button", { name: /^Android Health Connect/u });
  await expect(choice).toBeVisible();
  await choice.click();
  const health = page.getByRole("region", { name: "Health Connect", exact: true });
  await expect(health.getByRole("status")).toHaveText("Connecting to Health Connect…");
  const emit = (detail: Record<string, unknown>, matches = true) =>
    page.evaluate(
      ({ detail, matches }) => {
        const commands = (window as Window & { androidHealthCommands: HealthCommand[] })
          .androidHealthCommands;
        const start = commands.find((command) => command.action === "start");
        if (!start || start.owner !== "00000000-0000-4000-8000-000000000001")
          throw new Error("Missing owner binding");
        window.dispatchEvent(
          new CustomEvent("kova-health-update-v1", {
            detail: { ...detail, id: matches ? start.id : "another-user" },
          }),
        );
      },
      { detail, matches },
    );
  const reading = {
    report: {
      asOf: "2026-11-20",
      metrics: {
        StepCount: [{ date: "2026-11-20", value: 432 }],
        FlightsClimbed: [{ date: "2026-11-20", value: 999 }],
      },
    },
  };
  await emit(reading, false);
  await expect(page.getByText("432 steps", { exact: true })).toHaveCount(0);
  await emit(reading);
  await expect(page.getByText("432 steps", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("tab", { name: "Flights climbed", exact: true })).toHaveCount(0);
  await emit({ state: "permission_required" });
  await expect(health.getByRole("status")).toHaveText(
    "Allow at least one read permission in Health Connect to connect.",
  );
  await expect(page.getByText("432 steps", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as StateWindow).operations)).toEqual([]);
});
test("linked banks still load when new bank linking is unavailable", async ({ page }) => {
  await boot(page, { configured: false, readsConfigured: true, connection: true });
  await expect(page.getByText("Linking additional banks is currently unavailable.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect a bank" })).toBeDisabled();
  await expect(page.getByText("Fixture checking", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh balances and transactions" }),
  ).toBeEnabled();
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

test("the Health timeline keeps tracking a touch after pointer capture moves to the chart", async ({
  browser,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Chromium touch input");
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    const page = await context.newPage();
    await boot(page);
    await page.evaluate(() => {
      const viewport = document.createElement("meta");
      viewport.name = "viewport";
      viewport.content = "width=device-width, initial-scale=1";
      document.head.append(viewport);
    });
    await page.addStyleTag({
      content:
        'body { overflow-x: hidden; } [data-testid="health-timeline"] { width: 100%; height: 192px; touch-action: pan-y; }',
    });
    const chart = page.getByRole("slider", { name: "Steps timeline" });
    await chart.scrollIntoViewIfNeeded();
    const bounds = (await chart.boundingBox())!;
    const cdp = await context.newCDPSession(page);
    const start = bounds.x + bounds.width - 10;
    const end = bounds.x + 50;
    const y = bounds.y + 45;
    const reading = page.getByTestId("health-timeline-reading");
    await page.touchscreen.tap(start, y);
    await expect(reading).toContainText("2026-11-16");
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: start, y }],
    });
    for (let step = 1; step <= 6; step++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: start + ((end - start) * step) / 6, y }],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(reading).toContainText("2026-11-10");
    await chart.press("ArrowRight");
    await expect(reading).toContainText("2026-11-11");
  } finally {
    await context.close();
  }
});
