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
    assert.doesNotMatch(route, /Number\(request\.headers\.get\("content-length"\)/);
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
  assert.doesNotMatch(gmail, /buildRawEmail|base64UrlEncode|\/drafts\/send|\/messages\/send/);
  assert.doesNotMatch(calendar, /action === "(?:create|update|delete)"/);
});

test("confirmation reads and claims only the signed-in owner's row", () => {
  const executor = read("src/lib/google-tools.server.ts");
  const start = executor.indexOf("export async function executePendingAction");
  const end = executor.indexOf("export async function cancelPendingAction", start);
  const execute = executor.slice(start, end);

  const lookup = execute.slice(0, execute.indexOf("const pendingRow"));
  assert.match(lookup, /\.eq\("id", actionId\)\s*\.eq\("user_id", userId\)\s*\.maybeSingle\(\)/);
  const claim = execute.slice(
    execute.indexOf("Atomically claim"),
    execute.indexOf("let token", execute.indexOf("Atomically claim")),
  );
  assert.match(claim, /\.eq\("user_id", userId\)/);
  assert.match(claim, /\.eq\("status", "pending"\)/);
  assert.match(claim, /\.select\("id, tool, args, result"\)/);
});

test("claimed legacy arguments are revalidated immediately before Google access", () => {
  const executor = read("src/lib/google-tools.server.ts");
  const claim = executor.indexOf('.select("id, tool, args, result")');
  const revalidate = executor.indexOf("validateSupportedWrite(claimedTool,", claim);
  const token = executor.indexOf("getValidGoogleAccessToken(userId, {", revalidate);

  assert.ok(claim > -1 && revalidate > claim && token > revalidate);
  assert.match(executor, /const SUPPORTED_WRITE_TOOLS = new Set\(\[/);
  assert.match(executor, /"gmail_create_draft",\s*"gmail_send",\s*"calendar_create_event"/);
  assert.match(executor, /This action is no longer valid\. Prepare it again\./);
  assert.doesNotMatch(executor, /calendar_delete_event|drive_upload_text_file|drive_create_doc/);
});

test("Gmail send is confirmation-gated, exact in the approval card, and POST-only", () => {
  const executor = read("src/lib/google-tools.server.ts");
  const card = read("src/components/ToolConfirmCard.tsx");

  const activityStart = executor.indexOf("export const TOOL_ACTIVITY");
  const activityEnd = executor.indexOf("export const WRITE_TOOL_NAMES", activityStart);
  const activity = executor.slice(activityStart, activityEnd);
  assert.match(
    activity,
    /gmail_send: \{ running: "Preparing email for review…", done: "Email ready for review" \}/,
  );
  assert.doesNotMatch(activity, /Sent email/);

  const definitionStart = executor.indexOf('name: "gmail_send"');
  const definitionEnd = executor.indexOf('name: "calendar_create_event"', definitionStart);
  const definition = executor.slice(definitionStart, definitionEnd);
  assert.match(definition, /Only call when the user explicitly asks to send an email/);
  assert.match(definition, /confirm before anything is sent/);

  const claim = executor.indexOf("const claimedTool");
  const token = executor.indexOf("getValidGoogleAccessToken(userId, {", claim);
  const endpoint = executor.indexOf("${GMAIL}/users/me/messages/send", token);
  assert.ok(claim > -1 && token > claim && endpoint > token);
  assert.match(executor, /sending \? `\$\{GMAIL\}\/users\/me\/messages\/send`/);
  assert.match(executor, /method: "POST"/);
  assert.match(executor, /JSON\.stringify\(sending \? \{ raw \} : \{ message: \{ raw \} \}\)/);
  assert.match(executor, /foldEmailAddressHeader\("To", to\)/);
  assert.match(executor, /Content-Transfer-Encoding: base64/);
  assert.match(executor, /encodeMimeTextBody\(body\)/);
  assert.match(executor, /AbortSignal\.timeout\(GOOGLE_WRITE_TIMEOUT_MS\)/);
  assert.match(executor, /googleToolCapability/);
  assert.match(
    executor,
    /hasGoogleCapability\(health\.scopes, googleToolCapability\(tool\.function\.name\)\)/,
  );

  const summarizeStart = executor.indexOf("export function summarizeWriteTool");
  const summarizeEnd = executor.indexOf("export async function stagePendingAction", summarizeStart);
  const summarize = executor.slice(summarizeStart, summarizeEnd);
  assert.match(summarize, /to: sending \? to : truncate\(to, 120\)/);
  assert.match(summarize, /bcc: args\.bcc \? \(sending \? String\(args\.bcc\)/);
  assert.match(summarize, /body_preview: sending \? String\(args\.body \?\? ""\)/);

  assert.match(card, /preview\.bcc/);
  assert.match(card, />Bcc:<\/span>/);
  assert.match(card, /confirm\.tool === "gmail_send"[\s\S]*\? "Send"/);
});

test("confirmed writes stay bound to the staged Google account and use a recoverable lease", () => {
  const executor = read("src/lib/google-tools.server.ts");
  const oauth = read("src/lib/google-oauth.server.ts");

  assert.match(executor, /result: stagedBinding/);
  assert.match(executor, /staged_connection_id: connection\.id/);
  assert.match(executor, /staged_grant_id: connection\.grant_id/);
  assert.match(executor, /processing_started_at: new Date\(\)\.toISOString\(\)/);
  assert.match(
    executor,
    /getValidGoogleAccessToken\(userId, \{[\s\S]{0,250}connectionId: stagedConnectionId,[\s\S]{0,150}grantId: stagedGrantId/,
  );
  assert.match(
    executor,
    /Date\.now\(\) - new Date\(startedAt\)\.getTime\(\) > STALE_PROCESSING_MS/,
  );
  assert.match(executor, /abandoned_processing/);
  assert.match(oauth, /accountRuntime\(\)\.accessToken\(userId, binding\)/);
  const runtime = read("src/lib/google-account-runtime.server.mjs");
  assert.match(runtime, /owner\.sub !== conn\.google_sub/);
  assert.match(runtime, /grantId: selected\.grantId \?\? conn\.grant_id/);
});

test("ambiguous Gmail sends reconcile owner-scoped durable status", () => {
  const executor = read("src/lib/google-tools.server.ts");
  const route = read("src/routes/api/chat/confirm.ts");
  const card = read("src/components/ToolConfirmCard.tsx");
  const store = read("src/lib/chat-store.ts");

  const statusStart = executor.indexOf("export async function getPendingActionStatus");
  const statusEnd = executor.indexOf("export async function cancelPendingAction", statusStart);
  const statusLookup = executor.slice(statusStart, statusEnd);
  assert.match(statusLookup, /\.eq\("id", actionId\)\s*\.eq\("user_id", userId\)/);
  assert.match(route, /GET: async \(\{ request \}\)/);
  assert.match(route, /getPendingActionStatus\(auth\.userId, id\)/);
  assert.match(card, /\/api\/chat\/confirm\?action_id=/);
  assert.match(card, /statusJson\.status === "confirmed"/);
  assert.match(card, /json\.error_code === "completion_persistence_ambiguous"/);
  assert.match(route, /error_code: result\.error_code/);
  assert.match(card, /status: "uncertain"/);
  assert.match(card, /Check Sent mail before sending again/);
  assert.match(store, /"failed" \| "uncertain"/);
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
  assert.match(executor, /confirmationPersistError \|\| !confirmationPersisted/);
  assert.match(executor, /error_code: "completion_persistence_ambiguous"/);
  assert.match(executor, /Google completed the action, but KovaGPT could not verify completion/);
  assert.match(executor, /Google could not confirm whether the action completed/);
  assert.doesNotMatch(executor, /return \{ ok: false, error: msg \}/);
  assert.doesNotMatch(executor, /result: \{ error: msg \}/);
});
