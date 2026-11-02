import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { readFile, readdir } from "node:fs/promises";
interface PreviewWindow extends Window {
  fixture: {
    summary: Record<string, unknown>;
    checks: number;
    advance: () => void;
  };
}

test.use(
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } }
    : {},
);
let bundle = "",
  css = "";
test.beforeAll(async () => {
  const assets = await readdir("dist/client/assets");
  css = (
    await Promise.all(
      assets
        .filter((name) => name.endsWith(".css"))
        .map((name) => readFile(`dist/client/assets/${name}`, "utf8")),
    )
  ).join("\n");
  const result = await build({
    stdin: {
      contents: `
    import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import{Route}from'./src/routes/pricing';import{MessageActivityList}from'./src/components/MessageActivityList';
    window.fixture={summary:{tier:'free',effectiveTier:'free',inherited:false,activeSubscriptionCount:0,billingConflict:false,hasBillingAccount:false,billingPortalAvailable:false},checks:0};
    function Harness(){const[rows,setRows]=useState([{activityId:'intro',tool:'progress',presentation:'commentary',label:'I’m checking the sources.',status:'done'},{activityId:'search',tool:'search_web',hostname:'github.com',label:'Searching GitHub…',status:'running'}]);window.fixture.advance=()=>setRows(old=>[old[0],{...old[1],label:'Checked GitHub',status:'done'},{activityId:'review',tool:'progress',presentation:'commentary',label:'I have the result. I’m reviewing it.',status:'done'},{activityId:'read',tool:'read_source',hostname:'example.com',label:'Opening example.com…',status:'running'}]);return <><section aria-label="Progress preview"><MessageActivityList activities={rows}/></section><Route.component/></>};createRoot(document.getElementById('root')).render(<Harness/>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    loader: { ".css": "empty", ".svg": "dataurl" },
    plugins: [
      {
        name: "preview-boundaries",
        setup(b) {
          b.onResolve({ filter: /^@tanstack\/react-router$/ }, () => ({
            path: "router",
            namespace: "preview",
          }));
          b.onResolve({ filter: /^@\/components\/auth\/ClerkSafe$/ }, () => ({
            path: "auth",
            namespace: "preview",
          }));
          b.onResolve({ filter: /^@\/utils\/payments.functions$/ }, () => ({
            path: "payments",
            namespace: "preview",
          }));
          b.onResolve({ filter: /^@\/components\/StripeEmbeddedCheckout$/ }, () => ({
            path: "checkout",
            namespace: "preview",
          }));
          b.onResolve(
            {
              filter:
                /^@\/components\/(public\/(PublicShell|PlanComparison)|EnterpriseContactDialog)$/,
            },
            ({ path }) => ({ path: path.split("/").at(-1)!, namespace: "preview" }),
          );
          b.onLoad({ filter: /.*/, namespace: "preview" }, ({ path }) => ({
            loader: "jsx",
            resolveDir: process.cwd(),
            contents:
              path === "router"
                ? "import React from 'react';export const createFileRoute=()=>x=>x;export const Link=({children})=><a>{children}</a>"
                : path === "auth"
                  ? "export const useUser=()=>({isLoaded:true,isSignedIn:true,user:{id:'fixture-owner',email:'fixture@example.com'}});export const useClerkSafe=()=>({openSignIn(){}})"
                  : path === "payments"
                    ? "export const getSubscriptionSummary=async()=>{window.fixture.checks++;return window.fixture.summary};export const createPortalSession=async()=>({error:'Portal unavailable in fixture'})"
                    : path === "checkout"
                      ? "import React from 'react';export const StripeEmbeddedCheckout=()=> <iframe title='Secure checkout form' srcDoc='<p>Review payment</p>' style={{width:'100%',height:500}}/>"
                      : path === "PublicShell"
                        ? "import React from 'react';export const PublicShell=({children})=><div>{children}</div>"
                        : `export const ${path}=()=>null`,
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles[0].text;
});
async function mount(page: Page) {
  await page.route("https://preview.invalid/**", (route) =>
    route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }),
  );
  await page.goto("https://preview.invalid/");
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
}
test("progress sentences and branded website rows retain arrival order while work continues", async ({
  page,
}) => {
  await mount(page);
  const progress = page.getByRole("region", { name: "Progress preview" });
  await expect(progress.getByText("Searching GitHub…")).toBeVisible();
  await expect(progress.locator("img")).toHaveCount(1);
  await page.evaluate(() => (window as PreviewWindow).fixture.advance());
  await expect(progress.locator("li")).toHaveText([
    "I’m checking the sources.",
    /Completed: Checked GitHub/,
    "I have the result. I’m reviewing it.",
    /In progress: Opening example.com/,
  ]);
  await expect(progress.locator('[data-status="running"]')).toHaveCount(1);
});
for (const width of [390, 1440])
  test(`checkout fills the ${width}px viewport and checks the account before opening`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mount(page);
    await page.locator('[data-pricing-plan="plus"] button').click();
    const dialog = page.getByRole("dialog", { name: "Secure checkout" });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.x).toBe(0);
    expect(box!.y).toBe(0);
    expect(box!.width).toBe(width);
    expect(box!.height).toBe(844);
    expect(await page.evaluate(() => (window as PreviewWindow).fixture.checks)).toBe(1);
    await expect(dialog.getByTitle("Secure checkout form")).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toBeHidden();
  });
test("existing subscriptions go through plan management rather than a second checkout", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => {
    (window as PreviewWindow).fixture.summary = {
      ...(window as PreviewWindow).fixture.summary,
      activeSubscriptionCount: 1,
      hasBillingAccount: true,
      billingPortalAvailable: true,
    };
  });
  await page.locator('[data-pricing-plan="pro"] button').click();
  await expect(page.getByRole("alert")).toHaveText("Portal unavailable in fixture");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
