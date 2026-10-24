import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/components/Sidebar.tsx", "utf8");

test("pinned chats do not consume the eight recent chat slots", () => {
  assert.match(source, /pinned\.slice\(0, 8\)\.map\(chatRow\)/);
  assert.match(source, /recents\.slice\(0, 8\)\.map\(chatRow\)/);
  assert.doesNotMatch(source, /8 - pinned\.length/);
  assert.match(source, /filtered\.length > 0 \? \([\s\S]*?View all chats/);
});

test("account menu uses the specified order and a separate destructive group", () => {
  const start = source.indexOf('className="kova-profile-menu"');
  const menu = source.slice(start, source.indexOf("</DropdownMenuContent>", start));
  const labels = ["Profile", "Settings", "Usage", "Billing", "Help", "Log out"];
  let position = -1;
  for (const label of labels) {
    const match = menu.match(new RegExp(`>\\s*${label}\\s*<`));
    assert.ok(match, label);
    assert.ok(match.index > position, label);
    position = match.index;
  }
  assert.doesNotMatch(menu, /Customize sidebar/);
  assert.ok(menu.indexOf("<DropdownMenuSeparator") < menu.indexOf("Log out"));
});

test("sidebar customization remains reachable from expanded More and the rail", () => {
  const more = source.slice(
    source.indexOf('<details open={isOn("/work")'),
    source.indexOf("</nav>", source.indexOf('<details open={isOn("/work")')),
  );
  assert.match(
    more,
    /signedIn \? \([\s\S]*?aria-haspopup="dialog"[\s\S]*?openRailPersonalization\(event.currentTarget\)/,
  );
  assert.match(more, /Customize sidebar/);
  assert.match(source, /className="kova-rail-button kova-rail-customize"/);
});
