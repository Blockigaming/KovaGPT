import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chat = readFileSync("src/routes/api/chat.ts", "utf8");
const helper = readFileSync("src/lib/provider-response.server.mjs", "utf8");

test("chat bounds successful image, tool-hop, error, and streaming provider bodies", () => {
  for (const constant of [
    "MAX_IMAGE_PROVIDER_RESPONSE_BYTES",
    "MAX_TOOL_HOP_RESPONSE_BYTES",
    "MAX_ERROR_RESPONSE_BYTES",
    "MAX_CHAT_STREAM_BYTES",
  ]) {
    assert.match(chat, new RegExp(constant));
  }
  assert.match(chat, /readProviderJsonObject\([\s\S]{0,100}MAX_IMAGE_PROVIDER_RESPONSE_BYTES/u);
  assert.match(chat, /readProviderJsonObject\(hopRes, MAX_TOOL_HOP_RESPONSE_BYTES\)/u);
  assert.match(chat, /readProviderText\(res, MAX_ERROR_RESPONSE_BYTES\)/u);
  assert.match(chat, /createBoundedProviderSseStream\([\s\S]{0,120}MAX_CHAT_STREAM_BYTES/u);
  assert.match(chat, /X-Kova-Stream-Limit-Bytes/u);
  assert.match(chat, /final_provider_stream_limit/u);
  assert.doesNotMatch(chat, /await upstream\.json\(\)|await hopRes\.json\(\)/u);
  assert.doesNotMatch(chat, /res\.clone\(\)\.text\(\)/u);
  assert.doesNotMatch(chat, /return new Response\(upstream\.body,[\s\S]{0,120}text\/event-stream/u);
});

test("tool-hop structures are validated before execution", () => {
  assert.match(chat, /function parseToolHopResponse/u);
  assert.match(chat, /message\.tool_calls\.length > 16/u);
  assert.match(chat, /functionFields\.arguments\.length > 64 \* 1024/u);
  assert.match(chat, /tool_hop_invalid_response/u);
});

test("provider helper enforces declared and streamed byte limits and abort propagation", () => {
  assert.match(helper, /invalid_provider_content_length/u);
  assert.match(helper, /provider_response_truncated/u);
  assert.match(helper, /\^text\\\/event-stream/u);
  assert.match(helper, /new TextDecoder\("utf-8", \{ fatal: true \}\)/u);
  assert.match(helper, /provider_sse_incomplete_line/u);
  assert.match(helper, /provider_sse_missing_done/u);
  assert.match(helper, /data: \[DONE\]/u);
  assert.match(helper, /provider_sse_complete/u);
  assert.match(helper, /value\.byteLength > maxBytes - total/u);
  assert.match(helper, /new TextDecoder\("utf-8", \{ fatal: true \}\)/u);
  assert.match(helper, /signal\?\.addEventListener\("abort", onAbort/u);
  assert.match(helper, /reader\.cancel\("provider_response_rejected"\)/u);
});
