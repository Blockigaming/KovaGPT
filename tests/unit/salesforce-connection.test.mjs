import assert from "node:assert/strict";
import test from "node:test";
import {
  packSalesforceCredential,
  unpackSalesforceCredential,
  salesforceQueryUrl,
  salesforceOAuthEndpoint,
  renewSalesforceCredential,
  SALESFORCE_PROFILE_ENDPOINT,
} from "../../src/integrations/salesforce-credential.server.mjs";
import { readConnection } from "../../src/integrations/connection-read.server.mjs";
import { salesforceReadRequest } from "../../src/integrations/salesforce-read.server.mjs";
import { selectRefreshTokens } from "../../src/integrations/oauth-token-request.server.mjs";

const profile = {
  active: true,
  organization_id: "00D000000000001",
  user_id: "005000000000001",
  urls: { query: "https://fixture.my.salesforce.com/services/data/v67.0/query" },
};
const packed = packSalesforceCredential("test-access-token", profile);

test("Salesforce tokens are bound to a validated identity and Salesforce API endpoint", () => {
  assert.equal(unpackSalesforceCredential(packed).query_url, profile.urls.query);
  assert.equal(
    salesforceOAuthEndpoint(packed, "token"),
    "https://fixture.my.salesforce.com/services/oauth2/token",
  );
  assert.equal(
    salesforceOAuthEndpoint(packed, "revoke"),
    "https://fixture.my.salesforce.com/services/oauth2/revoke",
  );
  for (const value of [
    "http://fixture.my.salesforce.com/services/data/v67.0/query",
    "https://fixture.my.salesforce.com.evil.test/services/data/v67.0/query",
    "https://evil.test/services/data/v67.0/query",
    "https://127.0.0.1/services/data/v67.0/query",
    "https://user:secret@fixture.my.salesforce.com/services/data/v67.0/query",
    "https://fixture.my.salesforce.com:444/services/data/v67.0/query",
    "https://fixture.my.salesforce.com/services/data/v67.0/query?q=private",
    "https://fixture.my.salesforce.com/services/data/v67.0/query#x",
    "https://fixture.my.salesforce.com/services/oauth2/token",
    "https://fixture.my.salesforce.com/services/data/v67.0/query/extra",
  ])
    assert.throws(() => salesforceQueryUrl(value), /invalid_salesforce_binding/);
  for (const patch of [
    { active: false },
    { user_id: "001000000000001" },
    { organization_id: "005000000000001" },
  ])
    assert.throws(
      () => packSalesforceCredential("token", { ...profile, ...patch }),
      /invalid_salesforce_binding/,
    );
  for (const value of [
    "plain-token",
    "{}",
    JSON.stringify({ ...JSON.parse(packed), query_url: "https://evil.test/" }),
  ])
    assert.throws(() => unpackSalesforceCredential(value), /invalid_salesforce_binding/);
  assert.throws(() => salesforceOAuthEndpoint(packed, "authorize"), /invalid_salesforce_operation/);
});

test("Salesforce searches use fixed objects and fields and escape SOQL literals and wildcard characters", () => {
  for (const [recordType, object, fields] of [
    ["accounts", "Account", "Id,Name,Industry"],
    ["contacts", "Contact", "Id,Name,Title"],
    ["opportunities", "Opportunity", "Id,Name,StageName,CloseDate"],
  ]) {
    const request = salesforceReadRequest("O'Brien%_\\", packed, recordType);
    const url = new URL(request.url);
    assert.equal(url.origin, "https://fixture.my.salesforce.com");
    assert.equal(
      url.searchParams.get("q"),
      `SELECT ${fields} FROM ${object} WHERE Name LIKE '%O\\'Brien\\%\\_\\\\%' ORDER BY Name LIMIT 10`,
    );
    assert.equal(request.init.headers.Authorization, "Bearer test-access-token");
    assert.equal(request.init.method, "GET");
    assert.equal(request.init.redirect, "error");
  }
  for (const type of ["User", "Account LIMIT 999", "__proto__", "constructor"])
    assert.throws(
      () => salesforceReadRequest("name", packed, type),
      /invalid_salesforce_record_type/,
    );
  for (const query of ["", " ", "x".repeat(301), "a\nb"])
    assert.throws(() => salesforceReadRequest(query, packed), /invalid_connection_query/);
});

test("Salesforce results expose only bounded selected fields and trusted record links", async () => {
  for (const [recordType, id] of [
    ["accounts", "001000000000001"],
    ["contacts", "003000000000001"],
    ["opportunities", "006000000000001"],
  ]) {
    const result = await readConnection(
      "salesforce",
      "name",
      packed,
      async () =>
        Response.json({
          records: [
            {
              Id: id,
              Name: "Source",
              Industry: "Software",
              attributes: { url: "https://evil.test/" },
              Secret: "never-expose",
            },
          ],
          done: true,
          totalSize: 1,
        }),
      { recordType },
    );
    assert.equal(result.service, "Salesforce");
    assert.equal(result.results[0].url, `https://fixture.my.salesforce.com/${id}`);
    assert.equal(result.limited, false);
    assert.doesNotMatch(JSON.stringify(result), /test-access-token|never-expose|evil\.test/);
  }
  const rows = Array.from({ length: 10 }, () => ({
    Id: "001000000000001",
    Name: "🧪".repeat(400),
    Industry: "\u0000".repeat(1000),
    Title: "\u0000".repeat(1000),
    StageName: "\u0000".repeat(1000),
    CloseDate: "\u0000".repeat(1000),
  }));
  const bounded = await readConnection("salesforce", "name", packed, async () =>
    Response.json({ records: rows, done: true, totalSize: 10 }),
  );
  assert.equal(bounded.limited, true);
  assert.ok(bounded.results.length > 0 && bounded.results.length < 10);
  assert.ok(new TextEncoder().encode(JSON.stringify(bounded)).byteLength <= 24000);
  for (const data of [
    {
      records: Array.from({ length: 11 }, () => ({ Id: "001000000000001", Name: "Too many" })),
      done: true,
      totalSize: 11,
    },
    { records: [{ Id: "005000000000001", Name: "wrong object" }], done: true, totalSize: 1 },
    { records: [], done: "true", totalSize: 0 },
  ])
    await assert.rejects(
      readConnection("salesforce", "name", packed, async () => Response.json(data)),
      /invalid_connection_response/,
    );
});

test("Salesforce renewal verifies the same organization and user and never invents an expiration", async () => {
  const tokens = selectRefreshTokens("salesforce", {
    access_token: "renewed-token",
    scope: "api refresh_token openid",
  });
  assert.equal(tokens.expires_in, undefined);
  let checks = 0;
  const fetchProfile = async (url, init) => {
    assert.equal(url, SALESFORCE_PROFILE_ENDPOINT);
    assert.equal(init.headers.Authorization, "Bearer renewed-token");
    assert.equal(init.redirect, "error");
    return Response.json({
      ...profile,
      urls: { query: "https://moved.my.salesforce.com/services/data/v68.0/query" },
    });
  };
  const renewed = await renewSalesforceCredential(
    packed,
    tokens.access_token,
    async () => {
      checks++;
    },
    fetchProfile,
  );
  assert.equal(checks, 2);
  assert.equal(unpackSalesforceCredential(renewed).access_token, "renewed-token");
  for (const patch of [{ organization_id: "00D000000000002" }, { user_id: "005000000000002" }])
    await assert.rejects(
      renewSalesforceCredential(
        packed,
        "renewed-token",
        async () => {},
        async () => Response.json({ ...profile, ...patch }),
      ),
      /salesforce_identity_changed/,
    );
  await assert.rejects(
    renewSalesforceCredential(
      packed,
      "renewed-token",
      async () => {
        throw new Error("disconnected");
      },
      async () => {
        assert.fail("must not send token after disconnect");
      },
    ),
    /disconnected/,
  );
});
