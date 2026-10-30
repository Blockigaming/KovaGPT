import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
test("desktop chat header does not duplicate the sidebar brand or composer model picker", () => {
  const source = readFileSync("src/routes/index.tsx", "utf8");
  const header = source
    .split('<header className="kova-topbar kova-desktop-topbar')[1]
    .split("</header>")[0];
  assert.doesNotMatch(header, /ResponsiveModelSelector|NovaLogo/);
  assert.match(header, /sidebarOpen \? "" : "KovaGPT"/);
  assert.match(header, /conversationActions\(\)/);
  const composer = readFileSync("src/components/ChatInput.tsx", "utf8");
  assert.match(composer, /ResponsiveModelSelector|ModelSelector/);
});
