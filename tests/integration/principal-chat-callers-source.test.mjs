import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

const callerPaths = [
  "src/components/ArchivedChatsDialog.tsx",
  "src/components/WorkspaceIntelligence.tsx",
  "src/routes/context-packs.tsx",
  "src/routes/knowledge-graph.tsx",
  "src/routes/library.tsx",
  "src/routes/summary.tsx",
  "src/routes/index.tsx",
];

test("all remaining local chat callers carry the resolved principal", async () => {
  const [archived, intelligence, contextPacks, graph, library, summary] = await Promise.all(
    callerPaths.slice(0, 6).map(read),
  );

  assert.match(archived, /loadArchivedConversations\(userKey\)/);
  assert.match(archived, /saveArchivedConversations\(userKey, \[\]\)/);
  assert.equal(
    (archived.match(/removeArchivedConversation\(userKey, chat\.id\)/g) ?? []).length,
    2,
  );
  assert.match(archived, /archiveState\.principal === principal/);

  assert.match(intelligence, /loadConversations\(userKey\)/);
  assert.match(intelligence, /savePendingActive\(userKey, item\.id\)/);
  assert.match(intelligence, /remoteState\.principal === principal/);
  assert.match(intelligence, /if \(!isLoaded \|\| !isSignedIn\) return \[\]/);

  assert.match(contextPacks, /loadConversations\(userKey\)/);
  assert.match(contextPacks, /dataPrincipal === principal/);
  assert.match(contextPacks, /if \(!dataReady\) return \[\]/);

  assert.match(graph, /loadConversations\(userKey\)/);
  assert.match(graph, /savePendingActive\(userKey, node\.id\.replace\("local-chat:", ""\)\)/);
  assert.match(graph, /graphState\.principal === principal/);

  assert.match(library, /loadConversations\(userKey\)/);
  assert.match(library, /saveConversations\(\s*userKey,/);
  assert.match(library, /saveDraft\(userKey, null, context\)/);
  assert.match(library, /clearPendingActive\(userKey\)/);
  assert.match(library, /itemState\.principal === principal/);
  assert.match(library, /principalRef\.current !== principal/);
  assert.match(library, /const visiblePreviewItem = principalReady \? previewItem : null/);
  assert.match(
    library,
    /setPreviewItem\(null\);\s*setSelected\(\[\]\);\s*setLoadError\(null\);[\s\S]*\}, \[favoritesKey, principal\]\)/,
  );

  assert.match(summary, /loadConversations\(userKey\)/);
  assert.equal((summary.match(/savePendingActive\(userKey, c\.id\)/g) ?? []).length, 2);
  assert.match(summary, /conversationState\.principal === principal/);
  assert.match(summary, /queryKey: \["summary", "projects", userKey\]/);
});

test("the caller slice contains no direct legacy draft or pending-selection keys", async () => {
  const sources = await Promise.all(callerPaths.map(read));
  for (let index = 0; index < sources.length; index += 1) {
    assert.doesNotMatch(sources[index], /nova-gpt-pending-active|kova-draft:/, callerPaths[index]);
    assert.doesNotMatch(sources[index], /loadConversations\(\s*\)/, callerPaths[index]);
  }
});

test("home chat uses stable empty state and complete callback dependencies", async () => {
  const home = await read("src/routes/index.tsx");

  assert.match(home, /const EMPTY_CONVERSATIONS: Conversation\[\] = \[\]/);
  assert.match(
    home,
    /const conversations = principalReady \? conversationState\.items : EMPTY_CONVERSATIONS/,
  );
  assert.match(home, /\[activeId, conversations, setConversations, userKey\]/);
});
