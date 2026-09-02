import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routes = {
  projects: await readFile("src/routes/projects.tsx", "utf8"),
  project: await readFile("src/routes/projects.$projectId.tsx", "utf8"),
  files: await readFile("src/routes/files.tsx", "utf8"),
  memory: await readFile("src/routes/memory.tsx", "utf8"),
  research: await readFile("src/routes/research-planner.tsx", "utf8"),
};

test("workspace routes provide the shell skip-link target in every render branch", () => {
  for (const [name, source] of Object.entries(routes)) {
    assert.match(source, /<main[\s\S]{0,180}id="main-content"/, `${name} needs a main target`);
  }

  assert.match(routes.projects, /aria-busy=\{isLoading \|\| undefined\}/);
  assert.match(routes.projects, /id="projects-loading-title"/);
  assert.match(routes.project, /id="project-loading-title"/);
});

test("project and collection loaders reject stale principal responses and expose retries", () => {
  assert.match(routes.projects, /refreshSequenceRef/);
  assert.match(routes.projects, /currentUserKeyRef\.current !== requestUserKey/);
  assert.match(routes.project, /currentRequestKeyRef\.current !== loadRequestKey/);
  assert.match(routes.project, /Project could not be opened/);
  assert.doesNotMatch(routes.project, /if \(loading \|\| !project\)/);

  for (const source of [routes.files, routes.memory]) {
    assert.match(source, /let active = true/);
    assert.match(source, /active = false/);
    assert.match(source, /resolvedUserKey/);
    assert.match(source, />\s*Try again\s*</);
  }
});

test("workspace route error panels never expose raw backend messages", () => {
  for (const routeName of ["files", "memory", "projects", "project", "research"]) {
    const source = routes[routeName];
    assert.doesNotMatch(source, /description=\{loadError\}/, routeName);
    assert.doesNotMatch(source, />\s*\{(?:error|loadError)(?:\s*\?\?[^}]*)?\}\s*</, routeName);
  }
});

test("file sizes, memory identities, and research steps preserve their edge-case invariants", () => {
  assert.match(routes.files, /if \(n === 0\) return "0 B"/);
  assert.match(routes.files, /if \(n === null\) return "Size unavailable"/);

  assert.match(routes.memory, /function memoryRecordKey/);
  assert.match(routes.memory, /memoryRecordKey\(value\) === memoryRecordKey\(item\)/);
  assert.match(routes.memory, /memoryRecordKey\(duplicate\) === memoryRecordKey\(item\)/);
  assert.match(routes.memory, /editing === memoryRecordKey\(item\)/);

  assert.match(
    routes.research,
    /steps\.length > 0 && steps\.every\(\(step\) => step\.trim\(\)\.length > 0\)/,
  );
  assert.match(routes.research, /disabled=\{steps\.length === 1\}/);
  assert.match(routes.research, /!question\.trim\(\) \|\| !hasValidSteps/);
});

test("signed-out workspace states offer real authentication and hide data-only controls", () => {
  for (const source of [
    routes.projects,
    routes.project,
    routes.files,
    routes.memory,
    routes.research,
  ]) {
    assert.match(source, /<SignInButton mode="modal">/);
  }

  assert.match(routes.files, /!isSignedIn \? \(/);
  assert.match(routes.memory, /isSignedIn && !isLoading && !error/);
  assert.match(routes.research, /Sign in to plan research/);
});
