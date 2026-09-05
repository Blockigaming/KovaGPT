import { test, expect } from "@playwright/test";
import { build } from "esbuild";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
let bundle = "";
type Fixture = {
  calls: Array<{ name: string; data: Record<string, unknown> }>;
  requests: Array<{ owner: string; body: Record<string, unknown> }>;
  switchUser: () => void;
  temporary: () => void;
  reset: () => void;
};
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{StudyPanel}from'./src/components/StudyPanel';window.fixture={calls:[],requests:[],failSave:true};function Harness(){const[user,setUser]=useState('${owner}'),[temp,setTemp]=useState(false);window.fixture.switchUser=()=>setUser('${other}');window.fixture.temporary=()=>setTemp(true);window.fixture.reset=()=>window.dispatchEvent(new CustomEvent('kova:principal-browser-storage-cleared',{detail:{principal:'user:'+user}}));return <StudyPanel ownerId={user} temporary={temp} source="Private notes: two pairs contain four items."/>};createRoot(document.getElementById('root')).render(<Harness/>);`,
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
        name: "study-fixture",
        setup(builder) {
          builder.onResolve({ filter: /^@tanstack\/react-start$/ }, () => ({
            path: "start",
            namespace: "fixture",
          }));
          builder.onResolve({ filter: /study\.functions$/ }, () => ({
            path: "functions",
            namespace: "fixture",
          }));
          builder.onResolve({ filter: /chat-summary-snapshot\.mjs$/ }, () => ({
            path: "fetch",
            namespace: "fixture",
          }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            loader: "js",
            contents:
              args.path === "start"
                ? "export const useServerFn=fn=>fn"
                : args.path === "fetch"
                  ? String.raw`export async function fetchForPrincipal(owner,url,init){window.fixture.requests.push({owner,body:JSON.parse(init.body)});const card={question:'Two plus two?',choices:['Three','Four'],answer:1,hint:'Count two pairs.',explanation:'Two pairs make four.'};const deck={title:'Arithmetic practice',goal:'Add pairs',cards:[card,{...card,question:'How many items in two pairs?'}]};return new Response('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(deck)}}]})+'\n\ndata: [DONE]\n\n');}`
                  : `export async function listStudySets({data}){window.fixture.calls.push({name:'list',data});return []};export async function getStudySet({data}){window.fixture.calls.push({name:'get',data});throw new Error('Unavailable')};export async function saveStudySet({data}){window.fixture.calls.push({name:'save',data});if(window.fixture.failSave){window.fixture.failSave=false;throw new Error('Save response lost')};if(window.fixture.expireSave){window.fixture.expireSave=false;return {creationExpired:true}};return {id:data.id,creation_token:data.creationToken,owner_id:data.expectedUserId,revision:data.expectedRevision+1,body:data.body,deleted_at:null,updated_at:'2026-09-05'};}`,
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles[0].text;
});
async function mount(page: import("@playwright/test").Page) {
  await page.route("https://study-fixture.invalid/", (route) =>
    route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }),
  );
  await page.goto("https://study-fixture.invalid/");
  await page.addScriptTag({ content: bundle });
  await page.getByLabel("Learning goal", { exact: true }).fill("Understand pairs");
}
test("practice checks real answer keys, keeps exact lost-save retries and resets account state", async ({
  page,
}) => {
  await mount(page);
  await page.getByRole("button", { name: "Create practice", exact: true }).click();
  await page.getByRole("button", { name: "Three", exact: true }).click();
  await expect(
    page.getByText("Review the explanation, then try this concept again."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next card", exact: true }).click();
  await page.getByRole("button", { name: "Four", exact: true }).click();
  await expect(page.getByText(/2 of 2 cards practiced · 1 confident/)).toBeVisible();
  await page.getByRole("button", { name: "Save progress", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Save response lost");
  await page.getByRole("button", { name: "Retry unconfirmed save", exact: true }).click();
  const calls = await page.evaluate(() =>
    (window as unknown as { fixture: Fixture }).fixture.calls.filter(
      (call) => call.name === "save",
    ),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].data).toEqual(calls[1].data);
  expect(calls[0].data.expectedUserId).toBe(owner);
  await page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture.switchUser());
  await expect(page.getByText("Arithmetic practice", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Learning goal", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Notes or an explanation to practice")).toHaveValue("");
});
test("Temporary Chat disables persistence and generation excludes account memory", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture.temporary());
  await page.getByLabel("Learning goal", { exact: true }).fill("Learn privately");
  await page.getByRole("button", { name: "Create practice", exact: true }).click();
  await expect(page.getByText("Arithmetic practice", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save progress", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Load saved practice", exact: true })).toHaveCount(
    0,
  );
  const requests = await page.evaluate(
    () => (window as unknown as { fixture: Fixture }).fixture.requests,
  );
  expect(requests[0].body.temporary).toBe(true);
  expect(requests[0].body.temporaryContext).toBe("clean");
  expect(requests[0].body).not.toHaveProperty("chatId");
  expect(requests[0].body).not.toHaveProperty("user");
});
test("flashcards require reveal before a self-rating and hints never count as independent confidence", async ({
  page,
}) => {
  await mount(page);
  await page.getByRole("button", { name: "Create practice", exact: true }).click();
  await page.getByLabel("Practice style").selectOption("flashcard");
  await expect(page.getByRole("button", { name: "I recalled it", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Show a hint", exact: true }).click();
  await page.getByRole("button", { name: "Reveal answer", exact: true }).click();
  await page.getByRole("button", { name: "I recalled it", exact: true }).click();
  await expect(page.getByText(/1 of 2 cards practiced · 0 confident/)).toBeVisible();
});

test("device reset clears unsaved practice and its original private source", async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Create practice", exact: true }).click();
  await expect(page.getByText("Arithmetic practice", { exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture.reset());
  await expect(page.getByText("Arithmetic practice", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Notes or an explanation to practice")).toHaveValue("");
});

test("a deferred practice import blocks new answers until the reviewed replacement is ready", async ({
  page,
}) => {
  await mount(page);
  await page.getByRole("button", { name: "Create practice", exact: true }).click();
  page.on("dialog", (dialog) => dialog.accept());
  await page.evaluate(() => {
    File.prototype.text = function () {
      return new Promise<string>((resolve) => {
        (window as unknown as { releaseImport: () => void }).releaseImport = () =>
          resolve(
            JSON.stringify({
              version: 1,
              deck: {
                title: "Imported set",
                goal: "Review",
                cards: [
                  {
                    question: "Imported question?",
                    choices: ["Yes", "No"],
                    answer: 0,
                    hint: "Think",
                    explanation: "An imported explanation",
                  },
                ],
              },
              attempts: [],
            }),
          );
      });
    };
  });
  await page.getByLabel("Import an exported practice set").setInputFiles({
    name: "practice.json",
    mimeType: "application/json",
    buffer: Buffer.from("{}"),
  });
  const answer = page.getByRole("button", { name: "Four", exact: true });
  await expect(answer).toBeDisabled();
  // A native click on the disabled fieldset cannot add an answer that a late import would erase.
  await answer.evaluate((element: HTMLElement) => element.click());
  await expect(page.getByText(/0 of 2 cards practiced/)).toBeVisible();
  await page.evaluate(() => (window as unknown as { releaseImport: () => void }).releaseImport());
  await expect(page.getByText("Imported set", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Yes", exact: true })).toBeEnabled();
});

test("an expired first-save identity preserves local practice and permits a fresh save", async ({
  page,
}) => {
  await mount(page);
  await page.getByRole("button", { name: "Create practice", exact: true }).click();
  await page.getByRole("button", { name: "Save progress", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Save response lost");
  await page.evaluate(() => {
    (window as unknown as { fixture: { expireSave: boolean } }).fixture.expireSave = true;
  });
  await page.getByRole("button", { name: "Retry unconfirmed save", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Your practice is still here");
  await expect(page.getByText("Arithmetic practice", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save progress", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("saved to your account");
  const saves = await page.evaluate(() =>
    (window as unknown as { fixture: Fixture }).fixture.calls.filter((c) => c.name === "save"),
  );
  expect(saves).toHaveLength(3);
  expect(saves[0].data).toEqual(saves[1].data);
  expect(saves[2].data.id).not.toBe(saves[0].data.id);
});
