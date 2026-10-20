import { Buffer } from "node:buffer";
import { readResponseBytesBounded } from "./endpoint-reliability.mjs";
import {
  createRequestDeadline,
  waitForPromiseWithSignal,
} from "./ai/provider-transport.server.mjs";

const MAX_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 32_768;
const GSM_EXTENSION = new Set(["^", "{", "}", "\\", "[", "]", "~", "|"]);
const ACCEPTED_STATUSES = new Set(["accepted", "queued", "sending", "sent", "delivered"]);
const failed = (outcome, reason) => ({ outcome, reason, deliveryVerified: false });

function configurationSnapshot(value) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const { accountSid, apiKeySid, apiKeySecret, messagingServiceSid } = value;
    if (
      typeof accountSid !== "string" ||
      !/^AC[0-9a-fA-F]{32}$/u.test(accountSid) ||
      typeof apiKeySid !== "string" ||
      !/^SK[0-9a-fA-F]{32}$/u.test(apiKeySid) ||
      typeof apiKeySecret !== "string" ||
      !/^[\x21-\x7e]{16,4096}$/u.test(apiKeySecret) ||
      typeof messagingServiceSid !== "string" ||
      !/^MG[0-9a-fA-F]{32}$/u.test(messagingServiceSid)
    )
      throw new Error();
    return Object.freeze({ accountSid, apiKeySid, apiKeySecret, messagingServiceSid });
  } catch {
    throw new Error("twilio_sms_invalid_configuration");
  }
}

// Disabled operation does not even read a credential getter. Enabling the
// transport is separate from authorizing any particular live send.
export function loadTwilioSmsConfiguration(env = process.env) {
  if (env.KOVA_SMS_SEND_ENABLED !== "true") return null;
  if (env.KOVA_SMS_PROVIDER !== "twilio") throw new Error("twilio_sms_invalid_provider");
  return configurationSnapshot({
    accountSid: env.TWILIO_ACCOUNT_SID,
    apiKeySid: env.TWILIO_API_KEY_SID,
    apiKeySecret: env.TWILIO_API_KEY_SECRET,
    messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
  });
}

export function summarizeTwilioSmsConfiguration(config) {
  if (config !== null) configurationSnapshot(config);
  return Object.freeze({
    provider: "twilio",
    sendEnabled: config !== null,
    configurationValid: config !== null,
    authentication: "api_key",
    transport: "programmable_messaging",
    singleSegmentBody: true,
  });
}

function validateInput(input) {
  try {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => key !== "to" && key !== "body")
    )
      return failed("rejected", "invalid_input");
    const { to, body } = input;
    // E.164 formatting is not evidence that a number exists or is verified.
    if (typeof to !== "string" || !/^\+[1-9][0-9]{1,14}$/u.test(to))
      return failed("rejected", "invalid_recipient");
    if (
      typeof body !== "string" ||
      !body.trim() ||
      body.length > 160 ||
      !/^[\x20-\x7e]+$/u.test(body) ||
      body.includes("`")
    )
      return failed("rejected", "invalid_body");
    let septets = 0;
    for (const character of body) septets += GSM_EXTENSION.has(character) ? 2 : 1;
    if (septets > 160) return failed("rejected", "invalid_body");
    return { to, body };
  } catch {
    return failed("rejected", "invalid_input");
  }
}

function cancelBody(response) {
  try {
    void Promise.resolve(response?.body?.cancel()).catch(() => undefined);
  } catch {
    // Cancellation is best effort and cannot extend the send deadline.
  }
}

// Construction is offline. A caller must authorize each explicit send and
// handle uncertainty without silently retrying a potentially accepted POST.
export function createTwilioSmsSender(
  config,
  { fetcher = fetch, timeoutMs = MAX_TIMEOUT_MS } = {},
) {
  if (config === null) return async () => failed("disabled", "sending_disabled");
  const snapshot = configurationSnapshot(config);
  if (
    typeof fetcher !== "function" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMEOUT_MS
  )
    throw new Error("twilio_sms_invalid_transport_options");
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${snapshot.accountSid}/Messages.json`;
  const authorization = `Basic ${Buffer.from(`${snapshot.apiKeySid}:${snapshot.apiKeySecret}`, "utf8").toString("base64")}`;

  return async (input) => {
    const value = validateInput(input);
    if ("outcome" in value) return value;
    const deadline = createRequestDeadline(undefined, timeoutMs, "twilio_sms");
    let response;
    try {
      const request = Promise.resolve().then(() =>
        fetcher(endpoint, {
          method: "POST",
          redirect: "error",
          signal: deadline.signal,
          headers: {
            Authorization: authorization,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({
            To: value.to,
            Body: value.body,
            MessagingServiceSid: snapshot.messagingServiceSid,
            ValidityPeriod: "60",
          }).toString(),
        }),
      );
      // A fetch implementation ignoring AbortSignal may settle after timeout.
      void request.then(
        (lateResponse) => {
          if (deadline.signal.aborted) cancelBody(lateResponse);
        },
        () => undefined,
      );
      response = await waitForPromiseWithSignal(request, deadline.signal, "twilio_sms");
      if (
        response.redirected ||
        (response.status >= 300 && response.status < 400) ||
        (response.url && response.url !== endpoint)
      )
        return failed("uncertain", "redirect_rejected");
      if (response.status === 429) return failed("rejected", "rate_limited");
      if (response.status >= 400 && response.status < 500)
        return failed("rejected", "provider_rejected");
      if (
        response.status !== 201 ||
        !/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "")
      )
        return failed("uncertain", "unexpected_response");
      const bytes = await readResponseBytesBounded(response, MAX_RESPONSE_BYTES, {
        signal: deadline.signal,
        timeoutMs,
      });
      const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        typeof payload.sid !== "string" ||
        !/^SM[0-9a-fA-F]{32}$/u.test(payload.sid) ||
        payload.account_sid !== snapshot.accountSid ||
        payload.to !== value.to ||
        payload.messaging_service_sid !== snapshot.messagingServiceSid ||
        !ACCEPTED_STATUSES.has(payload.status) ||
        (payload.error_code !== undefined && payload.error_code !== null)
      )
        return failed("uncertain", "unexpected_response");
      // A create response, even one labelled delivered, is not a separately
      // verified delivery receipt. Do not return provider PII or error text.
      return {
        outcome: "accepted",
        messageId: payload.sid,
        status: payload.status,
        deliveryVerified: false,
      };
    } catch {
      return failed("uncertain", deadline.didTimeout() ? "timeout" : "transport_uncertain");
    } finally {
      cancelBody(response);
      deadline.cleanup();
    }
  };
}
