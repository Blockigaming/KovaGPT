import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("launch audit tracks resolved and intentionally deferred work", async () => {
  const audit = await read("docs/production-readiness.md");
  assert.match(audit, /Resolved in this checkpoint/);
  assert.match(audit, /Intentional deferred engineering/);
  assert.match(audit, /Launch gates outside this repository/);
  assert.match(audit, /Known build advisory/);
});

test("sensitive one-time workspace handoffs use session storage", async () => {
  const [handoffs, packs, prompts, apps, chat] = await Promise.all([
    read("src/lib/workspace-handoffs.ts"),
    read("src/routes/context-packs.tsx"),
    read("src/routes/prompt-studio.tsx"),
    read("src/routes/apps.tsx"),
    read("src/routes/index.tsx"),
  ]);
  assert.match(handoffs, /writePrincipalHandoff\(safeBrowserStorage\("sessionStorage"\)/);
  assert.match(handoffs, /writeHandoff\("kova-context-candidates", userKey/);
  assert.doesNotMatch(handoffs, /(?:local|session)Storage\.setItem/);
  assert.match(packs, /writePrincipalHandoff/);
  assert.match(prompts, /writePrincipalHandoff/);
  assert.match(apps, /writePrincipalHandoff/);
  assert.match(chat, /consumePrincipalHandoff/);
  for (const source of [packs, prompts, apps, chat])
    assert.match(source, /safeBrowserStorage\("sessionStorage"\)/);
});

test("unenforced family controls stay hidden and image ingestion is hardened", async () => {
  const [settings, images] = await Promise.all([
    read("src/components/SettingsDialog.tsx"),
    read("src/lib/library-images.functions.ts"),
  ]);
  assert.match(settings, /Family controls are not available yet/);
  assert.doesNotMatch(settings, /kova-family-pin|kova-safe-audience|PBKDF2/);
  assert.match(images, /SAFE_IMAGE_TYPES/);
  assert.match(images, /hasImageSignature/);
  assert.match(images, /redirect: "manual"/);
});

test("commercial surfaces avoid fake success and preserve recoverable work", async () => {
  const [apps, library, prompt, timeout, projects, help, states] = await Promise.all([
    read("src/routes/apps.tsx"),
    read("src/lib/library.functions.ts"),
    read("src/routes/prompt-studio.tsx"),
    read("src/lib/fetch-with-timeout.ts"),
    read("src/routes/projects.tsx"),
    read("src/routes/help.tsx"),
    read("src/components/states.tsx"),
  ]);
  assert.doesNotMatch(apps, /connected and ready/);
  assert.match(apps, /WORKING_IDS/);
  assert.match(library, /Library could not be loaded/);
  assert.match(prompt, /PROMPT_DRAFT_KEY/);
  assert.match(timeout, /TimeoutError/);
  assert.match(projects, /fetchWithTimeout/);
  assert.match(help, /Your message is still here/);
  assert.match(states, /Reconnect before retrying unsaved actions/);
});
