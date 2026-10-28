import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { libraryDeleteConfirmation } from "../../src/lib/library-delete-confirmation.ts";

const styles = await readFile("src/styles.css", "utf8");
const reference = await readFile("docs/kova-observable-reference.md", "utf8");
const projects = await readFile("src/routes/projects.tsx", "utf8");
const projectDetail = await readFile("src/routes/projects.$projectId.tsx", "utf8");
const projectFns = await readFile("src/lib/projects.functions.ts", "utf8");
const rag = await readFile("src/lib/project-rag.server.ts", "utf8");
const library = await readFile("src/routes/library.tsx", "utf8");
const chatInput = await readFile("src/components/ChatInput.tsx", "utf8");
const chatRoute = await readFile("src/routes/api/chat.ts", "utf8");
const chatStore = await readFile("src/lib/chat-store.ts", "utf8");
const managementStyles = await readFile("src/styles/spec400-management.css", "utf8");
const projectDetailStyles = await readFile("src/styles/project-detail.css", "utf8");
const dropdownMenu = await readFile("src/components/ui/dropdown-menu.tsx", "utf8");
const listPreferences = await readFile("src/lib/management-list-preferences.mjs", "utf8");

test("observable reference documents workspace measurements without private assets", () => {
  for (const phrase of [
    "Desktop content width",
    "Page padding",
    "Card radius",
    "Mobile header/tabs",
    "Light/dark contrast",
  ]) {
    assert.match(reference, new RegExp(phrase));
  }
  assert.doesNotMatch(reference, /OpenAI source|private ChatGPT infrastructure/i);
});

test("visual system exposes semantic workspace tokens and reusable classes", () => {
  for (const token of [
    "--surface-workspace",
    "--surface-raised",
    "--surface-input",
    "--kova-radius-card",
    "--kova-touch",
    "--motion-standard",
    ".kova-page",
    ".kova-toolbar",
    ".kova-empty-state",
    "prefers-reduced-motion",
  ]) {
    assert.match(styles, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("projects overview supports real search, sorting, view preference, counts, and permissions", () => {
  assert.match(
    projects,
    /usePrincipalSessionPreferences\(\s*PROJECT_LIST_STORAGE_BASE,\s*isLoaded \? userKey : undefined,\s*parseProjectDirectoryPreferences/,
  );
  assert.match(
    projects,
    /function parseProjectDirectoryPreferences\(raw: string \| null\): ProjectListPreferences \{\s*const preferences = parseProjectListPreferences\(raw\);\s*return raw === null \? \{ \.\.\.preferences, view: "list" \} : preferences;/,
  );
  assert.match(listPreferences, /PROJECT_LIST_STORAGE_BASE = "kova-project-list"/);
  assert.match(listPreferences, /view: value\.view === "list" \? "list" : "grid"/);
  assert.match(projects, /instructions_preview/);
  assert.match(projects, /chat_count/);
  assert.match(projects, /file_count/);
  assert.match(projects, /Grid view/);
  assert.match(projects, /List view/);
  assert.match(projects, /disabled=\{[\s\S]{0,100}p\.role === "viewer"/);
  assert.match(projectFns, /project_chats/);
  assert.match(projectFns, /project_files/);
  assert.match(projectFns, /system_prompt/);
});

test("project detail has instructions autosave states and mobile-safe tabs", () => {
  assert.match(projectDetail, /ProjectInstructionsTab/);
  assert.match(projectDetail, /setTimeout\(async \(\) =>/);
  assert.match(projectDetail, /Saving…/);
  assert.match(projectDetail, /Save failed/);
  assert.match(projectDetail, /Failed saves keep your unsaved text/);
  assert.match(projectDetail, /<TabsList aria-label="Project sections">/);
  assert.match(
    projectDetail,
    /<DropdownMenuTrigger asChild>[\s\S]{0,180}aria-label="More project tools"/,
  );
  assert.match(projectDetail, /<DropdownMenuRadioGroup value=\{tab\} onValueChange=\{setTab\}>/);
  for (const value of [
    "overview",
    "timers",
    "files",
    "images",
    "notes",
    "tasks",
    "memory",
    "members",
    "collaboration",
    "settings",
  ]) {
    assert.ok(projectDetail.includes(`<DropdownMenuRadioItem value="${value}">`));
  }
  assert.match(projectDetail, /\{isOwner \? "Settings" : "Access"\}/);
  assert.match(
    projectDetailStyles,
    /\.kova-project-workspace \.kova-project-tools-trigger\s*\{[^}]*min-height: 44px;/,
  );
  assert.match(managementStyles, /\.spec400-project-navigation\s*\{[^}]*flex-wrap: wrap;/);
  assert.match(
    projectDetailStyles,
    /\.kova-project-workspace \.spec400-project-tools\s*\{[^}]*max-width: 100%;/,
  );
  assert.match(
    projectDetailStyles,
    /@container project-detail \(max-width: 380px\)\s*\{\s*\.kova-project-workspace \.spec400-project-navigation\s*\{[^}]*flex-wrap: nowrap;/,
  );
  assert.match(
    dropdownMenu,
    /max-w-\[min\(var\(--radix-dropdown-menu-content-available-width,100vw\),calc\(100vw-1rem\)\)\]/,
  );
});

test("project context and RAG remain server-side and scoped to project membership", () => {
  assert.match(chatRoute, /_project_id: projectId/);
  assert.match(chatRoute, /Project instructions/);
  assert.match(chatRoute, /retrieveProjectContext/);
  assert.match(chatRoute, /Relevant excerpts from this project/);
  assert.match(rag, /match_project_chunks/);
  assert.match(rag, /embeddings\(\s*\{ model: embeddingModel\(\)/);
  assert.match(rag, /providerErrorFromResponse/);
  assert.doesNotMatch(rag, /LOVABLE|OPENAI_API_KEY|process\.env|response\.text\(/);
  assert.match(rag, /unsupported_type/);
});

test("library workspace supports filters, sorting, view preference, safe actions, and no invented storage", () => {
  for (const marker of [
    "kova-library-view",
    "FilterId",
    "SortId",
    "Grid view",
    "List view",
    "libraryDeleteConfirmation",
    "loadGuestLibrary",
    "deleteLibraryItem",
  ]) {
    assert.match(library, new RegExp(marker));
  }
  assert.match(
    library,
    /const storageKnown = items\.some\(\(item\) => typeof item\.file_size === "number"\)/,
  );
  assert.match(
    library,
    /const storageTotal = storageKnown\s+\? items\.reduce\([\s\S]*?\)\s+: null/,
  );
  assert.match(
    library,
    /storageTotal !== null && <p>Loaded file sizes: \{humanBytes\(storageTotal\)\}<\/p>/,
  );
  assert.match(library, /title=\{deleteSummary\.title\}/);
  assert.match(library, /description=\{deleteSummary\.description\}/);
  assert.match(library, /confirmLabel=\{deleteSummary\.confirmLabel\}/);
  assert.match(library, /pendingDelete\.principal === principal/);
  assert.match(library, /retentionMs !== pending\.retentionMs/);
  const chat = libraryDeleteConfirmation(
    [{ id: "chat:one", title: "Saved chat" }],
    30 * 86_400_000,
  );
  assert.equal(chat.confirmLabel, "Move to Trash");
  assert.match(chat.description, /can be restored for 30 days/);
  const file = libraryDeleteConfirmation(
    [{ id: "file:one", title: "Saved file", item_type: "upload" }],
    null,
  );
  assert.equal(file.confirmLabel, "Delete permanently");
  assert.match(file.description, /does not go to Trash and cannot be restored/);
  assert.doesNotMatch(library, /Storage totals require backend usage records/);
});

test("composer can reuse recent authorized Library files without duplicate upload", () => {
  assert.match(chatInput, /RecentLibraryFile/);
  assert.match(chatInput, /Saved Library files/);
  assert.match(chatInput, /attachLibraryFile/);
  assert.match(chatInput, /libraryItemId/);
  assert.match(chatInput, /is already attached/);
  assert.match(chatStore, /kind: "library_file"/);
  assert.match(chatRoute, /Attached Library file/);
  assert.match(chatRoute, /do not expose private URLs/);
});
