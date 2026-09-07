import { test, expect } from "@playwright/test";
import { build } from "esbuild";
type TaskBrowserFixture = {
  calls: Array<{ name: string; data: Record<string, unknown> }>;
  pending: Array<{
    grantId: string;
    resolve: (value: {
      items: Array<{ id: string; label: string }>;
      nextCursor: string | null;
    }) => void;
  }>;
  switchUser: () => void;
  user: string;
};
type TaskBrowserWindow = Window & { fixture: TaskBrowserFixture };
let bundle = "";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
test.beforeAll(async () => {
  const names = [
    "createScheduledTask",
    "updateScheduledTask",
    "offerScheduledTaskCopy",
    "listScheduledTaskRuns",
    "listScheduledTaskConnections",
    "grantScheduledTaskConnection",
    "revokeScheduledTaskConnection",
    "listScheduledTaskContextOptions",
    "listScheduledTaskResourceOptions",
  ];
  const result = await build({
    stdin: {
      contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{ScheduledTaskEditor}from'./src/components/ScheduledTaskEditor';
 window.fixture={calls:[],pending:[],failCreate:true,user:'${owner}'};
 function Harness(){const[user,setUser]=useState('${owner}');window.fixture.switchUser=()=>{window.fixture.user='${other}';setUser('${other}')};return <ScheduledTaskEditor userKey={user} draft={{title:user==='${owner}'?'Private old draft':'New account draft',prompt:'Saved prompt',localTime:'2027-01-01T09:00',repeat:'daily'}} executionAvailable={true} onClose={()=>{}} onSaved={()=>{}}/>};createRoot(document.getElementById('root')).render(<Harness/>);`,
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
        name: "task-fixture",
        setup(builder) {
          builder.onResolve({ filter: /^@tanstack\/react-start$/ }, () => ({
            path: "start",
            namespace: "fixture",
          }));
          builder.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({
            path: "supabase",
            namespace: "fixture",
          }));
          builder.onResolve({ filter: /scheduled-tasks\.functions$/ }, () => ({
            path: "functions",
            namespace: "fixture",
          }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            loader: "js",
            contents:
              args.path === "supabase"
                ? "export const supabase={auth:{getSession:async()=>({data:{session:{user:{id:window.fixture.user},access_token:'fixture-token'}}})}}"
                : args.path === "start"
                  ? "export const useServerFn=fn=>fn"
                  : names
                      .map(
                        (name) =>
                          `export const ${name}=async({data})=>{const f=window.fixture;f.calls.push({name:'${name}',data});if('${name}'==='listScheduledTaskConnections')return data.expectedUserId==='${owner}'?{connections:[],grants:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',provider:'github',connection_ref:'old',expires_at:'2027-01-01'},{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',provider:'github',connection_ref:'new',expires_at:'2027-01-01'},{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',provider:'gmail',connection_ref:'mail',expires_at:'2027-01-01'}]}:{connections:[],grants:[]};if('${name}'==='listScheduledTaskResourceOptions')return new Promise(resolve=>f.pending.push({grantId:data.grantId,resolve}));if('${name}'==='createScheduledTask'&&f.failCreate){f.failCreate=false;throw new Error('Response interrupted')};return {items:[],nextCursor:null};};`,
                      )
                      .join("\n"),
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles[0].text;
});
async function mount(page: import("@playwright/test").Page) {
  await page.route("https://tasks-fixture.invalid/", (route) =>
    route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }),
  );
  await page.goto("https://tasks-fixture.invalid/");
  await page.addScriptTag({ content: bundle });
}
test("Tasks retries the exact captured mutation and pins the rendered account", async ({
  page,
}) => {
  await mount(page);
  await page.getByLabel("Run this prompt in the background", { exact: false }).check();
  await page.getByRole("button", { name: "Schedule task", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Response interrupted");
  await expect(page.getByLabel("Title", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Retry the same request" }).click();
  const calls = await page.evaluate(() =>
    (window as unknown as TaskBrowserWindow).fixture.calls.filter(
      (call) => call.name === "createScheduledTask",
    ),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].data).toEqual(calls[1].data);
  expect(calls[0].data.expectedUserId).toBe(owner);
  expect(calls[0].data.mutationId).toBeTruthy();
});
test("Tasks discards late resource pages and resets private state on account change", async ({
  page,
}) => {
  await mount(page);
  await page.getByText("Connected sources and event filters", { exact: true }).click();
  await page
    .getByLabel("Task background approval")
    .selectOption("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  await page.getByRole("button", { name: "Browse readable sources" }).click();
  await page
    .getByLabel("Task background approval")
    .selectOption("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  await page.getByRole("button", { name: "Browse readable sources" }).click();
  await page.evaluate(() => {
    const pending = (window as unknown as TaskBrowserWindow).fixture.pending;
    pending[1].resolve({ items: [{ id: "new/repo", label: "Current source" }], nextCursor: null });
  });
  await expect(page.getByLabel("Connected source")).toContainText("Current source");
  await page.evaluate(() => {
    (window as unknown as TaskBrowserWindow).fixture.pending[0].resolve({
      items: [{ id: "private/repo", label: "Stale private source" }],
      nextCursor: null,
    });
  });
  await expect(page.getByLabel("Connected source")).not.toContainText("Stale private source");
  await page.evaluate(() => (window as unknown as TaskBrowserWindow).fixture.switchUser());
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("New account draft");
  await expect(page.locator("body")).not.toContainText("Current source");
  const last = await page.evaluate(() =>
    (window as unknown as TaskBrowserWindow).fixture.calls
      .filter((call) => call.name === "listScheduledTaskConnections")
      .at(-1),
  );
  expect(last?.data.expectedUserId).toBe(other);
});

test("selected Gmail event controls capture the approved account and disappear on account switch", async ({
  page,
}) => {
  const requests: Array<{
    user: string | null;
    grant: string | null;
    authorization: string | undefined;
  }> = [];
  await page.route("**/api/tasks/event-sources?**", async (route) => {
    const url = new URL(route.request().url());
    requests.push({
      user: url.searchParams.get("expectedUserId"),
      grant: url.searchParams.get("grantId"),
      authorization: route.request().headers().authorization,
    });
    await route.fulfill({
      json: { configured: { gmail: false }, watchConfigured: false, sources: [] },
    });
  });
  await mount(page);
  await page.getByLabel("Run when").selectOption("event");
  await page
    .getByLabel("Task background approval")
    .selectOption("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  await expect(page.getByRole("region", { name: "Gmail event delivery" })).toBeVisible();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toEqual({
    user: owner,
    grant: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    authorization: "Bearer fixture-token",
  });
  await page.evaluate(() => (window as unknown as TaskBrowserWindow).fixture.switchUser());
  await expect(page.getByRole("region", { name: "Gmail event delivery" })).toHaveCount(0);
});
