import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

function run(source) {
  return execFileSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", source],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  ).trim();
}

test("device exports validate and newer imported conversations win merge conflicts", () => {
  const output = run(`
    import { parseDeviceDataExport, mergeConversations } from './src/lib/device-data-portability.ts';
    const base = { id: 'chat-1', title: 'Old', mode: 'instant', createdAt: 1, updatedAt: 1, messages: [] };
    const incoming = { ...base, title: 'New', updatedAt: 2 };
    const parsed = parseDeviceDataExport(JSON.stringify({
      format: 'kovagpt-device-export', version: 1, exportedAt: new Date().toISOString(),
      scope: 'this-device', settings: {}, conversations: [incoming], archivedConversations: []
    }));
    console.log(JSON.stringify(mergeConversations([base], parsed.conversations)));
  `);
  assert.equal(JSON.parse(output)[0].title, "New");
});

test("device exports reject malformed and unknown-version files", () => {
  const output = run(`
    import { parseDeviceDataExport } from './src/lib/device-data-portability.ts';
    const failures = [];
    for (const value of ['not json', JSON.stringify({ format: 'kovagpt-device-export', version: 99 })]) {
      try { parseDeviceDataExport(value); } catch (error) { failures.push(error.message); }
    }
    console.log(JSON.stringify(failures));
  `);
  const failures = JSON.parse(output);
  assert.equal(failures.length, 2);
  assert.match(failures[0], /valid KovaGPT JSON export/);
  assert.match(failures[1], /version is not supported/);
});
test("device exports preserve bounded text-file attachments", () => {
  const output = run(`
    import { parseDeviceDataExport } from './src/lib/device-data-portability.ts';
    const attachment = { kind: 'text_file', name: 'notes.txt', content: 'real file context', fileType: 'text/plain', size: 17 };
    const conversation = { id: 'chat-file', title: 'File chat', mode: 'instant', createdAt: 1, updatedAt: 1,
      messages: [{ id: 'message-file', role: 'user', content: 'Analyze it', attachments: [attachment] }] };
    const parsed = parseDeviceDataExport(JSON.stringify({
      format: 'kovagpt-device-export', version: 1, exportedAt: new Date().toISOString(),
      scope: 'this-device', settings: {}, conversations: [conversation], archivedConversations: []
    }));
    console.log(JSON.stringify(parsed.conversations[0].messages[0].attachments[0]));
  `);

  assert.deepEqual(JSON.parse(output), {
    kind: "text_file",
    name: "notes.txt",
    content: "real file context",
    fileType: "text/plain",
    size: 17,
  });
});
