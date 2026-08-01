import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("Google JSON endpoints enforce streamed byte limits instead of trusting headers", () => {
  const helper = read("src/lib/bounded-json.server.mjs");
  const confirm = read("src/routes/api/chat/confirm.ts");
  const gmail = read("src/routes/api/google/gmail.ts");
  const calendar = read("src/routes/api/google/calendar.ts");

  assert.match(helper, /bytesRead \+= value\.byteLength/);
  assert.match(helper, /bytesRead > maxBytes/);
  assert.match(helper, /invalid_content_length/);
  assert.match(helper, /new TextDecoder\("utf-8", \{ fatal: true \}\)/);

  for (const route of [confirm, gmail, calendar]) {
    assert.match(route, /readBoundedJsonObject\(request,/);
    assert.match(route, /error instanceof BoundedJsonError/);
    assert.doesNotMatch(route, /request\.json\(\)/);
    assert.doesNotMatch(
      route,
      /Number\(request\.headers\.get\("content-length"\)/,
    );
  }
});

test("direct Google endpoints remain read-only", () => {
  const gmail = read("src/routes/api/google/gmail.ts");
  const calendar = read("src/routes/api/google/calendar.ts");

  assert.match(gmail, /if \(!new Set\(\["search", "read"\]\)\.has\(action\)\)/);
  assert.match(calendar, /if \(action !== "list"\)/);
  assert.match(gmail, /confirmation_required/);
  assert.match(calendar, /confirmation_required/);
  assert.doesNotMatch(gmail, /action === "(?:draft|send|trash)"/);
  assert.doesNotMatch(
    gmail,
    /buildRawEmail|base64UrlEncode|\/drafts\/send|\/messages\/send/,
  );
  assert.doesNotMatch(calendar, /action === "(?:create|update|delete)"/);
});

test("confirmation reads and claims only the signed-in owner's row", () => {
  const executor = read("src/lib/google-tools.server.ts");
  const start = executor.indexOf("export async function executePendingAction");
  const end = executor.indexOf(
    "export async function cancelPendingAction",
    start,
  );
  const execute = executor.slice(start, end);

  const lookup = execute.slice(0, execute.indexOf("const pendingRow"));
  assert.match(
    lookup,
    /\.eq\("id", actionId\)\s*\.eq\("user_id", userId\)\s*\.maybeSingle\(\)/,
  );
  const claim = execute.slice(
    execute.indexOf("Atomically claim"),
    execute.indexOf("let token", execute.indexOf("Atomically claim")),
  );
  assert.match(claim, /\.eq\("user_id", userId\)/);
  assert.match(claim, /\.eq\("status", "pending"\)/);
  assert.match(claim, /\.select\("id, tool, args"\)/);
});

test("claimed legacy arguments are revalidated immediately before Google access", () => {
  const executor = read("src/lib/google-tools.server.ts");
  const claim = executor.indexOf('.select("id, tool, args")');
  const revalidate = executor.indexOf(
    "validateSupportedWrite(claimedTool,",
    claim,
  );
  const token = executor.indexOf(
    "getValidGoogleAccessToken(userId)",
    revalidate,
  );

  assert.ok(claim > -1 && revalidate > claim && token > revalidate);
  assert.match(executor, /const SUPPORTED_WRITE_TOOLS = new Set\(\[/);
  assert.match(executor, /"gmail_create_draft",\s*"calendar_create_event"/);
  assert.match(executor, /This action is no longer valid\. Prepare it again\./);
  assert.doesNotMatch(
    executor,
    /gmail_send|calendar_delete_event|drive_upload_text_file|drive_create_doc/,
  );
});

test("expiration cannot overwrite a concurrently claimed or completed action", () => {
  const executor = read("src/lib/google-tools.server.ts");
  const start = executor.indexOf("new Date(pendingRow.expires_at)");
  const end = executor.indexOf("SUPPORTED_WRITE_TOOLS", start);
  const expiration = executor.slice(start, end);

  assert.match(expiration, /\.eq\("id", actionId\)/);
  assert.match(expiration, /\.eq\("user_id", userId\)/);
  assert.match(expiration, /\.eq\("status", "pending"\)/);
  assert.match(expiration, /\.select\("id"\)\s*\.maybeSingle\(\)/);
  assert.match(expiration, /expirationError/);
  assert.match(expiration, /if \(!expired\)/);
});

test("confirmation results fail safely when final persistence is ambiguous", () => {
  const executor = read("src/lib/google-tools.server.ts");

  assert.match(executor, /Action already completed\./);
  assert.match(
    executor,
    /confirmationPersistError \|\| !confirmationPersisted/,
  );
  assert.match(
    executor,
    /Google completed the action, but KovaGPT could not verify completion/,
  );
  assert.match(
    executor,
    /Google could not confirm whether the action completed/,
  );
  assert.doesNotMatch(executor, /return \{ ok: false, error: msg \}/);
  assert.doesNotMatch(executor, /result: \{ error: msg \}/);
});
