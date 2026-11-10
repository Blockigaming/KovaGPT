import assert from "node:assert/strict";
import test from "node:test";
import { discoveryEmailDomain } from "../../src/lib/workspace-discovery-policy.mjs";

test("consumer inboxes never qualify for discovery", () => {
  for (const address of [
    "x@gmail.com", "x@googlemail.com", "x@yahoo.com", "x@outlook.com",
    "x@hotmail.com", "x@icloud.com", "x@proton.me", "x@live.com",
  ]) assert.equal(discoveryEmailDomain(address), null);
});
test("custom domains are only candidates, never proof of a workspace", () => {
  assert.equal(discoveryEmailDomain("person@school.example"), "school.example");
  assert.equal(discoveryEmailDomain("person@work.example.org"), "work.example.org");
});
test("reject malformed and untrusted addresses", () => {
  for (const value of ["", "user", "@a.org", "x@", "a@bad..org", null, 2]) {
    assert.equal(discoveryEmailDomain(value), null);
  }
});
