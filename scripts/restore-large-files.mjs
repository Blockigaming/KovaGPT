#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const dir = "_restore";
const files = readdirSync(dir).filter((f) => f.includes(".part"));
const groups = new Map();
for (const f of files) {
  const m = f.match(/^(.*)\.part(\d+)$/);
  if (!m) continue;
  const key = m[1];
  const n = Number(m[2]);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({ n, f });
}

for (const [key, parts] of groups) {
  parts.sort((a, b) => a.n - b.n);
  const b64 = parts.map(({ f }) => readFileSync(join(dir, f), "utf8")).join("");
  const dest = key.includes("__") ? key.replaceAll("__", "/") : key;
  if (!dest.startsWith("src/")) {
    console.log("skip non-src", dest);
    continue;
  }
  const buf = Buffer.from(b64, "base64");
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  console.log("restored", dest, buf.length, "from", parts.length, "parts");
}
