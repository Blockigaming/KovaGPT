import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (path) => readFile(path, "utf8");
const [library, client, functions, supabaseTypes] = await Promise.all([
  read("src/routes/library.tsx"),
  read("src/lib/library-folders.ts"),
  read("src/lib/library.functions.ts"),
  read("src/integrations/supabase/types.ts"),
]);
test("retired folder UI does not hide items with existing folder metadata", () => {
  assert.match(functions, /folder_id/);
  assert.match(supabaseTypes, /folder_id: string \| null/);
  assert.doesNotMatch(library, /<LibraryFolderOrganizer\b|onFoldersDeleted=|onMoved=/);
  assert.doesNotMatch(library, /loadLibraryFolderScope\(principal\)/);
  assert.match(library, /scope: "all"/);
});
test("folder requests use authenticated bounded network calls", () => {
  assert.match(client, /originalLibraryHeaders\(ownerId, current\)/);
  assert.match(client, /AbortSignal\.any\(\[signal, AbortSignal\.timeout\(15_000\)\]\)/);
  assert.match(
    client,
    /current\.throwIfAborted\(\);[\s\S]*await originalLibraryHeaders\(ownerId, current\);[\s\S]*current\.throwIfAborted\(\);[\s\S]*await fetch\(path,/,
  );
  assert.match(client, /credentials: "same-origin"/);
  assert.match(client, /mode: "same-origin"/);
  assert.match(client, /redirect: "error"/);
  assert.match(client, /headers: \{ \.\.\.headers,/);
  assert.match(client, /signal: current/);
  assert.match(
    client,
    /readResponseBytesBounded\(response, 512 \* 1024, \{\s*signal,\s*timeoutMs: 15_000/,
  );
  assert.match(client, /return responseObject\(response, current\)/);
  assert.match(client, /\/api\/library\/folders/);
  assert.match(client, /\/api\/library\/bulk-move/);
  assert.match(client, /Cache-Control|cache: "no-store"/);
  assert.match(client, /LibraryFolderRequestError/);
});

test("Library refresh and load failures remain scoped to the current account", () => {
  assert.match(library, /loadGenerationRef\.current/);
  assert.match(library, /principalRef\.current/);
  assert.match(library, /disabled=\{loading \|\| folderBusy\}/);
  assert.match(library, /onClick=\{refreshLibrary\}/);
  assert.match(library, /setLoadError[\s\S]*setSelected\(\[\]\)[\s\S]*toast\.error/);
});
