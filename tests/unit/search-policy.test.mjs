import assert from "node:assert/strict";
import test from "node:test";
import {
  isExplicitWebSearchRequest,
  classifySearchProviderError,
} from "../../src/lib/ai/search-policy.mjs";

test("explicit search wording is distinguished from incidental recency terms", () => {
  assert.equal(
    isExplicitWebSearchRequest("Use live web search to find the latest changelog"),
    true,
  );
  assert.equal(isExplicitWebSearchRequest("Please search the web for this release"), true);
  assert.equal(isExplicitWebSearchRequest("What's the latest release?"), false);
  assert.equal(isExplicitWebSearchRequest("Search the local notes"), false);
});

test("provider diagnostics expose only bounded status and known code", () => {
  assert.deepEqual(classifySearchProviderError({ status: 403, code: "permission_denied" }), {
    status: 403,
    code: "permission_denied",
  });
  assert.deepEqual(
    classifySearchProviderError({ status: 200, code: "secret-from-body", prompt: "private text" }),
    { status: null, code: "provider_error" },
  );
  assert.deepEqual(classifySearchProviderError(new TypeError("private URL")), {
    status: null,
    code: "provider_error",
  });
});
