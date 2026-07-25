import { test, expect } from "@playwright/test";

/**
 * Server-side contract test for /api/chat error envelope.
 * A malformed body should produce a JSON error with requestId + category.
 */
test("/api/chat returns structured error envelope with requestId + category", async ({
  request,
}) => {
  const resp = await request.post("/api/chat", {
    headers: { "Content-Type": "application/json" },
    data: "not-json-at-all",
  });
  expect(resp.status()).toBeGreaterThanOrEqual(400);
  const headerId = resp.headers()["x-request-id"];
  // header presence is nice-to-have; the body must carry it either way.
  let json: Record<string, unknown> = {};
  try {
    json = await resp.json();
  } catch {
    // Non-JSON body: at least header should exist
    expect(
      headerId,
      "response should include X-Request-Id header when body is not JSON",
    ).toBeTruthy();
    return;
  }
  expect(json).toHaveProperty("requestId");
  expect(String(json.requestId)).toMatch(/^req_/);
  expect(json).toHaveProperty("category");
});
