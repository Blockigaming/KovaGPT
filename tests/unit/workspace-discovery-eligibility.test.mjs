import test from "node:test";
import assert from "node:assert/strict";
import {
  canDiscoverWorkspaces,
  normalizedEmailDomain,
} from "../../src/lib/workspace-discovery-eligibility.mjs";

test("personal addresses never reveal workspace discovery", () => {
  for (const domain of ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com"]) {
    assert.equal(canDiscoverWorkspaces({
      email: "person@" + domain, emailVerified: true, verifiedWorkspaceDomains: [domain],
    }), false);
  }
});

test("custom email alone is insufficient", () => {
  assert.equal(canDiscoverWorkspaces({ email: "a@school.edu", emailVerified: true }), false);
  assert.equal(canDiscoverWorkspaces({
    email: "a@school.edu", emailVerified: true, verifiedWorkspaceDomains: ["different.edu"],
  }), false);
});

test("requires verified account and authoritative matching domain", () => {
  const input = { email: "A@School.edu", verifiedWorkspaceDomains: ["school.edu"] };
  assert.equal(canDiscoverWorkspaces({ ...input, emailVerified: false }), false);
  assert.equal(canDiscoverWorkspaces({ ...input, emailVerified: true }), true);
  assert.equal(normalizedEmailDomain(" A@School.edu "), "school.edu");
});

test("invalid input fails closed", () => {
  assert.equal(canDiscoverWorkspaces({ email: "bad", emailVerified: true, verifiedWorkspaceDomains: ["bad"] }), false);
  assert.equal(canDiscoverWorkspaces({ email: "a@work.org", emailVerified: true, verifiedWorkspaceDomains: null }), false);
});
