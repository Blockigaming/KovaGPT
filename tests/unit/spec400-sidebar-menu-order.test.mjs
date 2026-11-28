import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/components/Sidebar.tsx", "utf8");

test("the scrollable history includes all pinned and recent chats", () => {
  assert.match(source, /pinned\.map\(chatRow\)/);
  assert.match(source, /recents\.map\(chatRow\)/);
  assert.doesNotMatch(source, /View all chats/);
});

test("account menu uses the specified order and a separate destructive group", () => {
  const start = source.indexOf('className="kova-profile-menu"');
  const menu = source.slice(start, source.indexOf("</DropdownMenuContent>", start));
  const labels = ["Personalization", "Profile", "Settings", "Help", "Log out"];
  assert.ok(menu.includes('"Upgrade plan"'));
  let position = menu.indexOf('"Upgrade plan"');
  for (const label of labels) {
    const match = menu.match(new RegExp(`>\\s*${label}\\s*<`));
    assert.ok(match, label);
    assert.ok(match.index > position, label);
    position = match.index;
  }
  assert.doesNotMatch(menu, />\s*(?:Usage|Subscriptions)\s*</);
  assert.doesNotMatch(menu, /Customize sidebar/);
  assert.ok(menu.indexOf("<DropdownMenuSeparator") < menu.indexOf("Log out"));
});

test("sidebar customization remains reachable from expanded More and the rail", () => {
  const start = source.indexOf('className="kova-sidebar-more-disclosure"');
  assert.ok(start >= 0, "expanded navigation retains the More disclosure");
  const more = source.slice(start, source.indexOf("</details>", start));
  assert.match(
    more,
    /signedIn \? \([\s\S]*?aria-haspopup="dialog"[\s\S]*?openRailPersonalization\(event.currentTarget\)/,
  );
  assert.match(more, /Customize sidebar/);
  assert.match(source, /className="kova-rail-button kova-rail-customize"/);
});
