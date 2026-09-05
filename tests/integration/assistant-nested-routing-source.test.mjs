import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const assistants = await readFile("src/routes/assistants.tsx", "utf8");
const assistantDetail = await readFile("src/routes/assistants.$assistantSlug.tsx", "utf8");

test("assistants renders its directory only at the exact assistants route", () => {
  assert.match(assistants, /component: AssistantsRoute/);
  assert.match(
    assistants,
    /function AssistantsRoute\(\)[\s\S]*?from: "\/assistants\/\$assistantSlug"[\s\S]*?shouldThrow: false[\s\S]*?return assistantMatch \? <Outlet \/> : <DirectoryPage \/>/,
  );
  assert.match(assistants, /function DirectoryPage\(\)[\s\S]*?return \(\s*<PublicPageView/);
});

test("assistant detail owns its single public page shell", () => {
  assert.doesNotMatch(
    assistants,
    /function AssistantsRoute\(\)[\s\S]*?return assistantMatch \?\s*<PublicPageView/,
  );
  assert.match(assistantDetail, /function Detail\(\)[\s\S]*?<PublicPageView/);
});
