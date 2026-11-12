import { test, expect } from "@playwright/test";
import { build } from "esbuild";
// This fixture verifies mutation replay, independently of the host's timezone database.
test.use({ timezoneId: "UTC" });
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
 function Harness(){const[user,setUser]=useState('${owner}');window.fixture.switchUser=()=>{window.fixture.user='${other}';setUser('${other}')};return <ScheduledTaskEditor userKey={user} draft={location.search ? undefined : {title:user==='${owner}'?'Private old draft':'New account draft',prompt:'Saved prompt',localTime:'2027-01-01T09:00',repeat:'daily'}} executionAvailable={true} onClose={()=>{}} onSaved={()=>{}}/>};createRoot(document.getElementById('root')).render(<Harness/>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    loader: { ".css": "empty" },
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
          builder.onResolve({ filter: /^@\/components\/auth\/ClerkSafe$/ }, () => ({
            path: "clerk-safe",
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
                : args.path === "clerk-safe"
                  ? "export const useClerkSafe=()=>({openSignIn(){throw new Error('Unexpected sign-in in the task fixture')}})"
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
async function mount(page: import("@playwright/test").Page, newSchedule = false) {
  const url = "https://tasks-fixture.invalid/" + (newSchedule ? "?new" : "");
  await page.route(url, (route) =>
    route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }),
  );
  await page.goto(url);
  await page.addScriptTag({ content: bundle });
}
test("Tasks retries the exact captured mutation and pins the rendered account", async ({
  page,
}) => {
  await mount(page);
  await page.getByLabel("Run this prompt in the background", { exact: false }).check();
  await page.getByRole("button", { name: "Save schedule", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Response interrupted");
  await expect(page.getByLabel("Title", { exact: true })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "Run when", exact: true })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "Frequency", exact: true })).toBeDisabled();
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
test("removed context and connection controls stay absent across account changes", async ({
  page,
}) => {
  await mount(page);
  for (const text of [
    "Saved chat or uploaded context",
    "Connected sources and event filters",
    "Approve background reads",
    "Browse readable sources",
  ]) {
    await expect(page.getByText(text, { exact: false })).toHaveCount(0);
  }
  await expect(page.getByRole("combobox", { name: "Task background approval" })).toHaveCount(0);
  await page.evaluate(() => (window as unknown as TaskBrowserWindow).fixture.switchUser());
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("New account draft");
  const reads = await page.evaluate(() =>
    (window as unknown as TaskBrowserWindow).fixture.calls.filter((call) =>
      /^(listScheduledTaskConnections|listScheduledTaskContextOptions|listScheduledTaskResourceOptions)$/.test(
        call.name,
      ),
    ),
  );
  expect(reads).toEqual([]);
});

test("new scheduled tasks never offer connected events or request event sources", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("**/api/tasks/event-sources?**", (route) => {
    requests.push(route.request().url());
    return route.fulfill({ json: { sources: [] } });
  });
  await mount(page);
  await page.getByRole("combobox", { name: "Run when", exact: true }).click();
  await expect(
    page.getByRole("option", { name: "A connected event matches", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.evaluate(() => (window as unknown as TaskBrowserWindow).fixture.switchUser());
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("New account draft");
  await expect(page.getByRole("region", { name: "Gmail event delivery" })).toHaveCount(0);
  expect(requests).toEqual([]);
});

test("a new reminder sends explicit typed intent and retains it for retries", async ({ page }) => {
  await mount(page, true);
  await page.getByLabel("Send a reminder").check();
  await page.getByLabel("Title", { exact: true }).fill("School form");
  await page.getByLabel("Reminder message", { exact: true }).fill("Bring the signed school form.");
  await page.getByLabel("Deliver this reminder at the scheduled time.").check();
  await page.getByRole("button", { name: "Save schedule", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Response interrupted");
  await page.getByRole("button", { name: "Retry the same request" }).click();
  const calls = await page.evaluate(() =>
    (window as unknown as TaskBrowserWindow).fixture.calls.filter(
      ({ name }) => name === "createScheduledTask",
    ),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].data).toEqual(calls[1].data);
  expect(calls[0].data).toMatchObject({
    taskKind: "reminder",
    triggerMode: "time",
    contextRefs: [],
    eventTriggers: [],
    prompt: "Bring the signed school form.",
    expectedUserId: owner,
  });
});
