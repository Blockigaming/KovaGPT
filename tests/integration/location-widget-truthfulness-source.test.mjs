import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const chatMessage = read("src/components/ChatMessage.tsx");
const infoChip = read("src/components/InfoChip.tsx");
const mapWidget = read("src/components/MapWidget.tsx");
const settings = read("src/components/SettingsDialog.tsx");
const modes = read("src/lib/modes.ts");
const start = read("src/start.ts");
const server = read("src/server.ts");

test("location cards keep caller compatibility without consuming principal data", () => {
  assert.match(
    chatMessage,
    /<InfoChip[\s\S]*?userKey=\{userKey\}[\s\S]*?principalResolved=\{principalResolved\}/,
  );
  assert.match(infoChip, /userKey: string \| null/);
  assert.match(infoChip, /principalResolved: boolean/);
  assert.match(
    infoChip,
    /<MapWidget[^>]*userKey=\{userKey\} principalResolved=\{principalResolved\}/,
  );
  assert.match(mapWidget, /userKey\?: string \| null/);
  assert.match(mapWidget, /principalResolved\?: boolean/);
  assert.match(mapWidget, /Map previews are not available yet/);
  assert.doesNotMatch(mapWidget, /userKey[),]|principalResolved[),]/);
});

test("map cards do not read, store, or transmit device coordinates", () => {
  assert.doesNotMatch(mapWidget, /localStorage|LOCATION_KEY_BASE|navigator\.geolocation/);
  assert.doesNotMatch(mapWidget, /<iframe|openstreetmap|latitude|longitude/iu);
});

test("location and copy controls expose truthful availability and failure states", () => {
  assert.match(infoChip, /toast\.error\("Couldn't copy this card/);
  assert.match(infoChip, /min-h-11 min-w-11/);
  assert.match(infoChip, /aria-label=\{copied \? "Copied" : "Copy card"\}/);
  assert.match(settings, /Device location is not requested/);
  assert.match(settings, /will not request, save, or send your device coordinates/);
  assert.doesNotMatch(settings, /navigator\.geolocation|getCurrentPosition|LOCATION_KEY_BASE/);
  assert.match(modes, /does not request or store device coordinates/);
  assert.match(modes, /ask them to provide the relevant city, region, or place/);
});

test("production response paths do not allow an unused map-frame origin", () => {
  for (const source of [start, server]) {
    assert.match(source, /frame-src https:\/\/js\.stripe\.com https:\/\/hooks\.stripe\.com/);
    assert.doesNotMatch(source, /openstreetmap/);
  }
});
