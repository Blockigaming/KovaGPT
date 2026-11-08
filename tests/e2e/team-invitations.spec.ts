import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { readFile, readdir } from "node:fs/promises";
let bundle = "";
const owner = "11111111-1111-4111-8111-111111111111";
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{TeamPage}from'./src/routes/team';window.teamFixture={calls:[],failSend:false,added:true,workspace:{invitations:[],teams:[{id:'22222222-2222-4222-8222-222222222222',name:'Design studio',owner:true,status:'active',standard:2,premium:0,paidUntil:'2099-01-01',members:[{user_id:'${owner}',email:'owner@example.invalid',seat:'standard',state:'active'},{user_id:'11111111-1111-4111-8111-111111111112',email:'alex@example.invalid',seat:'standard',state:'active'}],emailInvitations:[]}]}};createRoot(document.getElementById('root')).render(<TeamPage/>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    loader: { ".css": "empty" },
    plugins: [
      {
        name: "team-fixture",
        setup(builder) {
          builder.onResolve({ filter: /^@tanstack\/react-start$/ }, () => ({
            path: "start",
            namespace: "fixture",
          }));
          builder.onResolve({ filter: /^@tanstack\/react-router$/ }, () => ({
            path: "router",
            namespace: "fixture",
          }));
          builder.onResolve({ filter: /ClerkSafe$/ }, () => ({
            path: "auth",
            namespace: "fixture",
          }));
          builder.onResolve({ filter: /team-billing\.functions$/ }, () => ({
            path: "functions",
            namespace: "fixture",
          }));
          builder.onResolve({ filter: /^lucide-react$/ }, () => ({
            path: process.cwd() + "/src/components/ui/product-icons.tsx",
          }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            loader: "jsx",
            resolveDir: process.cwd(),
            contents:
              args.path === "start"
                ? "export const useServerFn=f=>f"
                : args.path === "router"
                  ? "import React from'react';export const createFileRoute=()=>()=>({});export const Link=({to,children,...props})=><a href={to} {...props}>{children}</a>"
                  : args.path === "auth"
                    ? `export const useUser=()=>({user:{id:'${owner}'},isLoaded:true,isSignedIn:true});export const SignInButton=({children})=>children;`
                    : `export const getTeamWorkspace=async()=>window.teamFixture.workspace;
 export const reviewTeamInvitation=async({data})=>{const f=window.teamFixture;f.calls.push({name:'review',data});return{id:'33333333-3333-4333-8333-333333333333',state:'draft',quote:{added:f.added,interval:'month',recurring:f.added?2500:0,beforeTax:f.added?1250:0,total:f.added?1328:0}}};
 export const sendTeamInvitation=async({data})=>{const f=window.teamFixture;f.calls.push({name:'send',data});if(f.failSend)throw new Error('Payment needs confirmation. No invitation was sent.');return{ready:true,emailSent:true,paymentUrl:null}};
 export const manageTeamInvitation=async({data})=>{window.teamFixture.calls.push({name:'manage',data});return{ok:true}};
 export const createTeamCheckout=async()=>({url:'https://checkout.stripe.com/fixture'});export const createTeamPortal=async()=>({url:'https://billing.stripe.com/p/session/fixture'});export const cancelTeamCheckout=async()=>({ok:true});export const mutateTeamMember=async()=>({ok:true});`,
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles[0].text;
});
async function mount(page: import("@playwright/test").Page) {
  await page.route("https://team-fixture.invalid/", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto("https://team-fixture.invalid/");
  const assets = await readdir("dist/client/assets");
  const css = assets.filter((n) => n.endsWith(".css") && n.startsWith("styles-"));
  if (!css.length) throw new Error("Build stylesheet required for layout verification");
  await page.addStyleTag({
    content: (await Promise.all(css.map((n) => readFile("dist/client/assets/" + n, "utf8")))).join(
      "\n",
    ),
  });
  await page.addScriptTag({ content: bundle });
  await expect(page.getByText("Design studio", { exact: true })).toBeVisible();
}
test("invitation reviews before-tax and recurring costs before any billing mutation", async ({
  page,
}) => {
  await mount(page);
  await page.getByLabel("Email address", { exact: true }).fill("new@example.invalid");
  await page.getByRole("button", { name: "Review invitation", exact: true }).click();
  await expect(page.getByText("Estimated charge today, before tax", { exact: true })).toBeVisible();
  await expect(page.getByText("$12.50", { exact: true })).toBeVisible();
  await expect(page.getByText("$25.00 / month", { exact: true })).toBeVisible();
  if (process.env.KOVA_TEAM_UI_PROOF === "1")
    await page.screenshot({
      path: test.info().outputPath("team-invitation-review.png"),
      fullPage: true,
    });
  expect(
    await page.evaluate(() => (window as any).teamFixture.calls.map((c: any) => c.name)),
  ).toEqual(["review"]);
  await page.getByRole("button", { name: "Send invitation & add seat", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Invitation emailed");
  expect(
    await page.evaluate(() => (window as any).teamFixture.calls.map((c: any) => c.name)),
  ).toEqual(["review", "send"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("available seats carry no new charge and cancel never sends an invitation", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => {
    (window as any).teamFixture.added = false;
    (window as any).teamFixture.workspace.teams[0].members.pop();
  });
  await page.getByLabel("Email address", { exact: true }).fill("new@example.invalid");
  await page.getByRole("button", { name: "Review invitation", exact: true }).click();
  await expect(page.getByText("Available seat", { exact: true })).toBeVisible();
  await expect(page.getByText("$0.00 / month", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).teamFixture.calls.map((c: any) => c.name)),
  ).toEqual(["review", "manage"]);
});
test("payment failure preserves the reviewed invitation and never reports email success", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => ((window as any).teamFixture.failSend = true));
  await page.getByLabel("Email address", { exact: true }).fill("new@example.invalid");
  await page.getByRole("button", { name: "Review invitation", exact: true }).click();
  await page.getByRole("button", { name: "Send invitation & add seat", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("No invitation was sent");
  await expect(
    page.getByRole("button", { name: "Send invitation & add seat", exact: true }),
  ).toBeVisible();
  expect(await page.getByRole("status").count()).toBe(0);
});
