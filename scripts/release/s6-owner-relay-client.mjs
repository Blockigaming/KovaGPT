import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { fetch, EnvHttpProxyAgent } from "undici";
import { ORIGIN } from "./s6-deployed-checks.mjs";

export class OwnerRelayClient {
  constructor(token, request = fetch) {
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    this.token = token;
    this.request = request;
    this.dispatcher = new EnvHttpProxyAgent();
  }
  async call(data) {
    const response = await this.request(ORIGIN + "/api/internal/s6-owner-relay", {
      method: data ? "POST" : "GET",
      redirect: "error",
      dispatcher: this.dispatcher,
      signal: AbortSignal.timeout(12000),
      headers: { Authorization: "Bearer " + this.token, "Content-Type": "application/json" },
      body: data ? JSON.stringify(data) : undefined,
    });
    assert.ok(response.ok, `owner relay rejected request (${response.status})`);
    return response.json();
  }
  async open(runId, baseline) {
    const ticket = randomBytes(32).toString("base64url");
    await this.call({
      action: "open",
      runId,
      baseline,
      ticketHash: createHash("sha256").update(ticket).digest("hex"),
    });
    return {
      origin: ORIGIN,
      runId,
      ticket,
      sourceSha: baseline.sourceSha,
      deadline: baseline.deadline,
    };
  }
  async claim(invitation) {
    assert.equal(invitation.origin, ORIGIN);
    assert.match(invitation.runId, /^[a-f0-9]{12}$/);
    assert.ok(invitation.deadline > Date.now() + 180000);
    const result = await this.call({ action: "claim", runId: invitation.runId });
    assert.equal(result.runId, invitation.runId);
    assert.equal(result.baseline.origin, ORIGIN);
    assert.equal(result.baseline.sourceSha, invitation.sourceSha);
    assert.equal(result.baseline.deadline, invitation.deadline);
    assert.match(result.receiptToken, /^[A-Za-z0-9_-]{43}$/);
    this.token = result.receiptToken;
    return result.baseline;
  }
  async close() {
    this.token = "";
    await this.dispatcher.close();
  }
}
