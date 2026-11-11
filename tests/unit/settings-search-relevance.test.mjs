import test from "node:test";
import assert from "node:assert/strict";
import { settingsSearchMatches } from "../../src/lib/settings-search.mjs";

test("verification resolves Security even though the section label is different", () => {
  assert.equal(settingsSearchMatches({v:"security", label:"Security and login"}, "verification"), true);
  assert.equal(settingsSearchMatches({v:"security", label:"Security and login"}, "verify account"), true);
});
test("related settings terms and minor typos produce navigable results", () => {
  assert.equal(settingsSearchMatches({v:"memory",label:"Personalization"}, "remember"), true);
  assert.equal(settingsSearchMatches({v:"billing",label:"Subscriptions"}, "invoce"), true);
  assert.equal(settingsSearchMatches({v:"linked",label:"Connections"}, "health tools"), true);
  assert.equal(settingsSearchMatches({v:"usage",label:"Usage"}, "message limits"), true);
});
test("unrelated searches do not indiscriminately select every category", () => {
  assert.equal(settingsSearchMatches({v:"voice",label:"Voice"}, "verification"), false);
  assert.equal(settingsSearchMatches({v:"security",label:"Security and login"}, "iPad design"), false);
});
