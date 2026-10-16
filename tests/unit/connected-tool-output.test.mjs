import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { pathToFileURL } from "node:url";
import {
  serializeConnectedToolOutput,
  CONNECTED_TOOL_OUTPUT_BYTES,
} from "../../src/lib/connected-tool-output.mjs";
const { executeProviderRead } = await import(
  process.env.KOVA_PROVIDER_MODULE
    ? pathToFileURL(process.env.KOVA_PROVIDER_MODULE).href
    : "../../src/integrations/launch-providers.server.mjs"
);
function chatSerialize(out) {
  const source = ts.createSourceFile(
    "chat.ts",
    readFileSync(process.env.KOVA_CHAT_SOURCE ?? "src/routes/api/chat.ts", "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  let expression;
  function visit(n) {
    if (
      ts.isVariableDeclaration(n) &&
      n.name.getText(source) === "content" &&
      n.initializer?.getText(source).includes("out")
    )
      expression = n.initializer.getText(source);
    ts.forEachChild(n, visit);
  }
  visit(source);
  assert.ok(expression);
  return new Function("out", "serializeConnectedToolOutput", "return " + expression)(
    out,
    serializeConnectedToolOutput,
  );
}
async function readText(body, size = new TextEncoder().encode(body).length, id = "onedrive") {
  let calls = 0;
  return executeProviderRead(
    id,
    "read_file_text",
    { id: "file", ...(id === "sharepoint" ? { siteId: "site" } : {}) },
    { accessToken: "private", scopes: id === "onedrive" ? ["Files.Read"] : ["Sites.Read.All"] },
    null,
    {
      fetchImpl: async () => {
        calls++;
        if (calls === 1)
          return Response.json({
            id: "file",
            name: "file.txt",
            size,
            eTag: "revision",
            file: { mimeType: "text/plain" },
            "@microsoft.graph.downloadUrl": "https://tenant.sharepoint.com/download",
          });
        if (calls === 2) return new Response(body);
        return Response.json({ id: "file", eTag: "revision" });
      },
    },
  );
}
test("actual chat result transport preserves 30 KB ASCII and multibyte file endings, revision and untrusted labels", async () => {
  for (const provider of ["onedrive", "sharepoint"])
    for (const body of ["a".repeat(30000) + "END", "😀漢é".repeat(6500) + "END"]) {
      const read = await readText(body, undefined, provider);
      const raw = chatSerialize(read),
        decoded = JSON.parse(raw);
      assert.equal(decoded.items[0].text, body);
      assert.equal(decoded.items[0].complete, true);
      assert.equal(decoded.items[0].revision, "revision");
      assert.equal(decoded.contentIsUntrusted, true);
      assert.ok(new TextEncoder().encode(raw).length <= CONNECTED_TOOL_OUTPUT_BYTES);
    }
});
test("escaped text and metadata overhead yield valid explicit omission with no invented continuation", () => {
  for (const value of [
    { items: [{ text: "\u0001".repeat(60000), complete: true, revision: "rev" }] },
    { items: [{ text: "ok", complete: true }], metadata: "漢".repeat(40000) },
  ]) {
    const raw = chatSerialize(value),
      result = JSON.parse(raw);
    assert.equal(result.error, "connected_result_too_large");
    assert.equal(result.complete, false);
    assert.equal(result.contentOmitted, true);
    assert.equal(result.contentIsUntrusted, true);
    assert.equal(result.nextCursor, null);
    assert.equal(result.items, undefined);
    assert.ok(new TextEncoder().encode(raw).length <= CONNECTED_TOOL_OUTPUT_BYTES);
  }
});
test("original text downloads reject short and long 200 bodies even with unchanged eTag", async () => {
  for (const body of ["abc", "abcdef"])
    await assert.rejects(readText(body, 5), /file_content_unavailable/);
});
test("download byte count uses raw stream bytes including BOM and multibyte text, not JS length", async () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0xc3, 0xa9]);
  const read = await readText(bytes, 5);
  assert.equal(read.items[0].text, "é");
  assert.equal(read.items[0].complete, true);
  await assert.rejects(readText(bytes, 4), /file_content_unavailable/);
  const empty = await readText("", 0);
  assert.equal(empty.items[0].text, "");
});
