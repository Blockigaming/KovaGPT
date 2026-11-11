import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeTeamDomain } from "../../src/lib/team-domain-policy.mjs";

test("consumer domains never qualify for workspace DNS verification", () => {
  for (const domain of ["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "proton.me"]) {
    assert.equal(normalizeTeamDomain(domain), null, domain);
  }
});

test("organization domains are normalized and structurally validated", () => {
  assert.equal(normalizeTeamDomain(" SCHOOL.edu. "), "school.edu");
  assert.equal(normalizeTeamDomain("Company.COM"), "company.com");
  assert.equal(normalizeTeamDomain("dept.school.edu"), "dept.school.edu");
  for (const domain of ["localhost", "www..example.com", "-bad.example.com", "bad-.example.com", "1.2.3.4", "https://school.edu", "a@school.edu"]) {
    assert.equal(normalizeTeamDomain(domain), null, domain);
  }
});

test("domain activation has server-side owner check and DNS TXT proof before record creation", () => {
  const server = readFileSync("src/lib/team-domains.functions.ts", "utf8");
  assert.match(server, /await assertOwner\(data\.teamId, context\.ownerId\)/);
  assert.match(server, /dns\.resolveTxt\(proof\.recordHost\)/);
  assert.match(server, /record\.join\("") === proof\.txtValue/);
  assert.match(server, /context\.revalidate/);
  assert.match(server, /upsert\(/);
  assert.match(server, /verification_method: "dns_txt"/);
  const team = readFileSync("src/routes/team.tsx", "utf8");
  assert.match(team, /<TeamDomainVerificationPanel teamId=\{team\.id\}/);
});

test("Settings only offers workspace joining after server-confirmed matching domain", () => {
  const settings = readFileSync("src/components/SettingsDialog.tsx", "utf8");
  const discovery = readFileSync("src/components/WorkspaceDiscoverySettings.tsx", "utf8");
  assert.match(settings, /<WorkspaceDiscoverySettings/);
  assert.match(discovery, /findAvailableWorkspaces\(/);
  assert.match(discovery, /submitWorkspaceJoinRequest\(/);
  assert.match(discovery, /workspace_join_requested/);
});
