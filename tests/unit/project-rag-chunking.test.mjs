import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function readFunctions(path, names) {
  const source = readFileSync(path, "utf8");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  return file.statements
    .filter((node) =>
      ts.isFunctionDeclaration(node)
        ? names.has(node.name?.text)
        : ts.isVariableStatement(node) &&
          node.declarationList.declarations.some((declaration) =>
            names.has(declaration.name.getText(file)),
          ),
    )
    .map((node) => node.getText(file).replace(/^export\s+/, ""))
    .join("\n");
}

const implementation = [
  readFunctions("src/lib/sanitize-text.ts", new Set(["removeNulCharacters"])),
  readFunctions(
    "src/lib/project-rag.server.ts",
    new Set(["CHUNK_SIZE", "CHUNK_OVERLAP", "MAX_CHUNKS_PER_FILE", "chunkText"]),
  ),
].join("\n");
const compiled = ts.transpileModule(implementation, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const chunkText = new Function(`${compiled}; return chunkText;`)();

test("empty normalized content produces no embedding inputs", () => {
  assert.deepEqual(chunkText(" \r\n\0\t "), []);
});

test("a short file and an exact-size file produce one complete embedding input", () => {
  for (const length of [1, 180, 200, 201, 1199, 1200]) {
    const text = "x".repeat(length);
    const chunks = chunkText(text);
    assert.equal(chunks.length, 1, `length ${length}`);
    assert.equal(chunks[0], text);
  }
});

test("the final overlapping window is emitted once and preserves the document tail", () => {
  for (const length of [1201, 2200, 2201, 3250]) {
    const text = "x".repeat(length - 9) + "FINAL_END";
    const chunks = chunkText(text);
    assert.equal(chunks.length, 1 + Math.ceil((length - 1200) / 1000));
    assert.equal(chunks[0], text.slice(0, 1200));
    assert.equal(chunks.at(-1).endsWith("FINAL_END"), true);
    for (let index = 1; index < chunks.length; index++) {
      assert.equal(chunks[index], text.slice(index * 1000, index * 1000 + 1200));
      assert.equal(chunks[index - 1].slice(-200), chunks[index].slice(0, 200));
    }
  }
});

test("paragraph boundaries and the existing per-file chunk ceiling remain effective", () => {
  const text = "A".repeat(850) + "\n\n" + "B".repeat(850) + "\n\n" + "C".repeat(750);
  const chunks = chunkText(text);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0], "A".repeat(850));
  assert.equal(chunks.at(-1).endsWith("C".repeat(750)), true);
  assert.ok(chunks.every((chunk) => chunk.length > 0 && chunk.length <= 1200));
  assert.equal(chunkText("x".repeat(250_000)).length, 200);
});
