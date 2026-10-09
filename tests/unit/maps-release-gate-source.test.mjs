import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const expectedSidebarCallers = ["src/components/AppShell.tsx", "src/components/ChatWorkspace.tsx"];

test("MAN-09 keeps the release gate closed", () => {
  const gate = readFileSync("src/lib/maps-release-gate.ts", "utf8");

  assert.match(gate, /export const MAPS_RELEASE_APPROVED = false;/u);
});

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.tsx?$/u.test(entry.name) ? [path] : [];
  });
}

test("every Sidebar caller supplies the Maps release decision", () => {
  const callers = sourceFiles("src")
    .filter((path) => /<Sidebar(?:\s|\/?>)/u.test(readFileSync(path, "utf8")))
    .sort();

  assert.deepEqual(callers, expectedSidebarCallers);
  assert.match(readFileSync("src/routes/images.tsx", "utf8"), /<AppShell>/u);
  for (const path of callers) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /import \{ MAPS_RELEASE_APPROVED \} from "@\/lib\/maps-release-gate";/u);
    assert.match(
      source,
      /<Sidebar[\s\S]*?mapsReleaseApproved=\{MAPS_RELEASE_APPROVED\}[\s\S]*?\/>/u,
    );
  }
});

test("Core launch omits Maps navigation while retaining the compatibility input", () => {
  const sidebar = readFileSync("src/components/Sidebar.tsx", "utf8");

  assert.match(sidebar, /mapsReleaseApproved\?: boolean/u);
  assert.doesNotMatch(sidebar, /<Link\s+to="\/maps"/u);
  assert.doesNotMatch(sidebar, /navLink\("\/maps"/u);
});

test("Maps route metadata does not advertise an unapproved provider experience", () => {
  const route = readFileSync("src/routes/maps.tsx", "utf8");

  assert.match(
    route,
    /Maps is unavailable while provider, legal, privacy, capacity, and cost approval is pending\./u,
  );
  assert.doesNotMatch(route, /Explore real places/u);
});
