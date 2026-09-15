import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("Study generation uses a capable mode selected from the authoritative caller tier", () => {
  const panel = read("src/components/StudyPanel.tsx");
  const chat = read("src/routes/api/chat.ts");

  assert.match(panel, /clientTool: "study"/);
  assert.match(panel, /mode: "thinking"/);
  assert.match(
    chat,
    /!customKova && clientTool === "study" && auth[\s\S]*studyModeForTier\(callerTier\)/,
  );
});
