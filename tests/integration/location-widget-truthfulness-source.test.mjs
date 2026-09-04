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
const settingsStorage = read("src/lib/settings-storage.ts");
const modes = read("src/lib/modes.ts");
const start = read("src/start.ts");
const server = read("src/server.ts");

test("location cards receive and isolate the resolved browser principal", () => {
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
  assert.match(mapWidget, /loadPrincipalStoredRecord\(LOCATION_KEY_BASE, userKey/);
  assert.match(mapWidget, /migrateLegacyGuest: userKey === null/);
  assert.match(mapWidget, /browserStoragePrincipal\(userKey\)/);
  assert.match(mapWidget, /setLoaded\(null\)/);
  assert.match(mapWidget, /loaded\?\.principal === principal/);
  assert.doesNotMatch(mapWidget, /localStorage\.getItem\("kova-location"\)/);
});

test("map embeds accept only finite latitude and longitude within geographic bounds", () => {
  assert.match(mapWidget, /Number\.isFinite\(lat\)/);
  assert.match(mapWidget, /lat < -90/);
  assert.match(mapWidget, /lat > 90/);
  assert.match(mapWidget, /Number\.isFinite\(lon\)/);
  assert.match(mapWidget, /lon < -180/);
  assert.match(mapWidget, /lon > 180/);
  assert.match(mapWidget, /event\.key === storageKey/);
  assert.match(mapWidget, /LOCATION_STORAGE_CHANGED_EVENT/);
  assert.match(mapWidget, /PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT/);
});

test("location and copy controls expose truthful success and failure states", () => {
  assert.match(infoChip, /toast\.error\("Couldn't copy this card/);
  assert.match(infoChip, /min-h-11 min-w-11/);
  assert.match(infoChip, /aria-label=\{copied \? "Copied" : "Copy card"\}/);
  assert.match(settingsStorage, /LOCATION_STORAGE_CHANGED_EVENT/);
  assert.match(settings, /window\.dispatchEvent\(new Event\(LOCATION_STORAGE_CHANGED_EVENT\)\)/);
  assert.match(settings, /Location could not be saved in this browser/);
  assert.match(settings, /if \(saved\) toast\.success\("Location saved"\)/);
  assert.match(settings, /used only to render an\s+OpenStreetMap location card in this browser/);
  assert.match(settings, /they are not added to chat requests/);
  assert.doesNotMatch(settings, /it improves answers about local time, weather/);
  assert.doesNotMatch(settings, /answer questions about local time/);
  assert.match(modes, /Browser-stored coordinates[\s\S]*not included in chat requests/);
  assert.match(modes, /ask them to provide the relevant city, region, or place/);
  assert.doesNotMatch(modes, /mention enabling it once at most per conversation/);
});

test("both production response paths allow the OpenStreetMap card frame", () => {
  for (const source of [start, server]) {
    assert.match(
      source,
      /frame-src https:\/\/js\.stripe\.com https:\/\/hooks\.stripe\.com https:\/\/www\.openstreetmap\.org/,
    );
  }
});
