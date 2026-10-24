import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projects = await readFile("src/routes/projects.tsx", "utf8");
const projectDetail = await readFile("src/routes/projects.$projectId.tsx", "utf8");
const projectChat = await readFile("src/routes/projects.$projectId.chat.$chatId.tsx", "utf8");

test("projects renders its overview only at the exact projects route", () => {
  assert.match(projects, /component: ProjectsRoute/);
  assert.match(
    projects,
    /function ProjectsRoute\(\)[\s\S]*?from: "\/projects\/\$projectId"[\s\S]*?shouldThrow: false[\s\S]*?return projectMatch \? <Outlet \/> : <ProjectsPage \/>/,
  );
  // Shell options may vary; nesting correctness does not depend on a bare JSX tag.
  assert.match(projects, /function ProjectsPage\(\)[\s\S]*?return \(\s*<AppShell\b[^>]*>/);
});

test("project detail yields to its nested chat without adding a second shell", () => {
  assert.match(projectDetail, /component: ProjectDetailRoute/);
  assert.match(
    projectDetail,
    /function ProjectDetailRoute\(\)[\s\S]*?from: "\/projects\/\$projectId\/chat\/\$chatId"[\s\S]*?shouldThrow: false[\s\S]*?return chatMatch \? <Outlet \/> : <ProjectDetailPage \/>/,
  );
  assert.match(
    projectDetail,
    /function ProjectDetailPage\(\)[\s\S]*?return \(\s*<AppShell\b[^>]*>/,
  );
  assert.match(projectChat, /function ProjectChatPage\(\)[\s\S]*?<AppShell\b[^>]*>/);
});
