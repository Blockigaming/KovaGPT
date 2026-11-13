#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const map = {
  "apps.tsx": "src/routes/apps.tsx",
  "ChatMessage.tsx": "src/components/ChatMessage.tsx",
  "connectors-catalog.ts": "src/lib/connectors-catalog.ts",
};

for (const [base, dest] of Object.entries(map)) {
  const parts = readdirSync("_restore")
    .filter((f) => f.startsWith(base + ".part"))
    .sort((a, b) => {
      const na = Number(a.split(".part").pop());
      const nb = Number(b.split(".part").pop());
      return na - nb;
    });
  if (!parts.length) {
    console.log("skip", base, "(no parts)");
    continue;
  }
  const b64 = parts.map((f) => readFileSync(join("_restore", f), "utf8")).join("");
  const buf = Buffer.from(b64, "base64");
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  console.log("restored", dest, buf.length, "from", parts.length, "parts");
}
