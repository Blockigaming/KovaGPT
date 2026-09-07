import {
  canonicalWorkInput,
  workInputHash,
  workUuid,
} from "../src/lib/work-execution-protocol.mjs";
import { browserOrigin, createBrowserEgress } from "./browser-egress.mjs";
const fail = () => {
  throw new Error("work_browser_action_denied");
};
export function validateBrowserAction(action, input) {
  if (
    action !== "browser_interact" ||
    !input ||
    !["navigate", "snapshot", "click", "scroll"].includes(input.operation) ||
    Object.keys(input).some(
      (k) => !["sessionId", "operation", "url", "view", "target", "delta"].includes(k),
    )
  )
    fail();
  workUuid(input.sessionId);
  if (
    input.operation === "navigate" &&
    (typeof input.url !== "string" || input.url.length > 4096 || !input.url.startsWith("https://"))
  )
    fail();
  if (input.operation === "click") {
    workUuid(input.view);
    workUuid(input.target);
  }
  if (
    input.operation === "scroll" &&
    (!Number.isInteger(input.delta) || Math.abs(input.delta) > 900)
  )
    fail();
  if (Buffer.byteLength(canonicalWorkInput(input)) > 6000) fail();
  return input;
}
/** In-memory browser content only. Durable DB sequence is authoritative; an
 * ambiguous command closes its container and cannot be replayed. */
export function createBrowserManager(
  { store, factory, authorize, origins },
  egressFactory = createBrowserEgress,
) {
  const allowed = origins.map(browserOrigin);
  if (!allowed.length || allowed.length > 20 || new Set(allowed).size !== allowed.length) fail();
  const sessions = new Map(),
    retired = new Map();
  const capabilities = {
    protocol: "kova-browser-v1",
    available: true,
    origins: allowed,
    maxSessionSeconds: 300,
  };
  async function check(row, binding, signal) {
    if (
      signal?.aborted ||
      (await store.ownerRetired(row.ownerId)) ||
      Date.now() >= row.expiresAt ||
      row.closed
    )
      fail();
    const current = await authorize(binding, signal);
    if (
      current.expiresAt !== row.expiresAt ||
      (binding.phase === "check" && current.sequence !== binding.sequence)
    )
      fail();
    return current;
  }
  async function close(row) {
    row.closed = true;
    row.active?.controller.abort();
    sessions.delete(row.sessionId);
    retired.set(row.sessionId, row.expiresAt);
    await row.container?.close();
  }
  async function run(row, command, binding, signal) {
    if (row.busy || row.closed || command.sequence <= row.sequence || Date.now() >= row.expiresAt)
      fail();
    row.busy = true;
    row.sequence = command.sequence;
    const controller = new AbortController();
    row.active = { binding, controller };
    const current = AbortSignal.any([
      controller.signal,
      signal ?? new AbortController().signal,
      AbortSignal.timeout(20000),
    ]);
    try {
      await check(row, binding, current);
      const result = await row.container.command(command);
      await check(row, binding, current);
      if (result.sequence !== command.sequence) fail();
      if (command.operation === "release") row.mode = "agent";
      if (command.operation === "takeover") row.mode = "takeover";
      if (command.operation === "close") await close(row);
      return { sessionId: row.sessionId, runId: row.runId, ...result };
    } catch (error) {
      await close(row);
      throw error;
    } finally {
      row.active = null;
      row.busy = false;
    }
  }
  return {
    capabilities,
    async probe() {
      for (const row of sessions.values()) if (row.expiresAt <= Date.now()) await close(row);
      await factory.reapExpired();
      return factory.probe();
    },
    async command(input, signal) {
      for (const key of ["ownerId", "runId", "sessionId"]) workUuid(input[key]);
      if (
        input.actor !== "owner" ||
        !Number.isSafeInteger(input.sequence) ||
        input.sequence < 1 ||
        input.sequence > 1000000 ||
        !Number.isSafeInteger(input.expiresAt) ||
        input.expiresAt <= Date.now() ||
        input.expiresAt > Date.now() + 300000 ||
        Object.keys(input).some(
          (k) =>
            ![
              "ownerId",
              "runId",
              "sessionId",
              "actor",
              "sequence",
              "expiresAt",
              "operation",
              "url",
              "view",
              "target",
              "text",
              "key",
              "delta",
            ].includes(k),
        )
      )
        fail();
      return store.withOwnerLock(input.ownerId, async () => {
        if (await store.ownerRetired(input.ownerId)) fail();
        const binding = {
          phase: "check",
          ownerId: input.ownerId,
          runId: input.runId,
          sessionId: input.sessionId,
          actor: "owner",
          sequence: input.sequence,
        };
        let row = sessions.get(input.sessionId);
        if (input.operation === "open") {
          for (const stale of sessions.values())
            if (stale.expiresAt <= Date.now()) await close(stale);
          for (const [id, expiry] of retired) if (expiry < Date.now()) retired.delete(id);
          if (
            row ||
            retired.has(input.sessionId) ||
            sessions.size >= 4 ||
            retired.size >= 1000 ||
            [...sessions.values()].filter((r) => r.ownerId === input.ownerId).length >= 2
          )
            fail();
          row = {
            ownerId: input.ownerId,
            runId: input.runId,
            sessionId: input.sessionId,
            expiresAt: input.expiresAt,
            sequence: 0,
            mode: "takeover",
            busy: true,
            closed: false,
          };
          sessions.set(row.sessionId, row);
          try {
            await check(row, binding, signal);
            row.container = await factory.create({
              ...row,
              onNetwork: async (request, authority) => {
                const active = row.active;
                if (
                  !active ||
                  active.binding.actor !== authority.actor ||
                  active.binding.sequence !== authority.sequence ||
                  row.sequence !== authority.sequence
                )
                  fail();
                const egress = egressFactory({
                  origins: allowed,
                  assertAuthority: () => check(row, active.binding, active.controller.signal),
                });
                return egress(request, {
                  signal: active.controller.signal,
                  allowWrites: authority.actor === "owner" && row.mode === "takeover",
                });
              },
            });
            row.busy = false;
            return await run(
              row,
              { ...input, operation: input.url ? "navigate" : "snapshot" },
              binding,
              signal,
            );
          } catch (error) {
            await close(row);
            throw error;
          }
        }
        if (
          !row ||
          row.ownerId !== input.ownerId ||
          row.runId !== input.runId ||
          row.expiresAt !== input.expiresAt
        )
          fail();
        return run(row, input, binding, signal);
      });
    },
    async catalog(input) {
      const output = [];
      for (const row of sessions.values()) {
        if (
          row.ownerId !== input.ownerId ||
          row.runId !== input.runId ||
          row.mode !== "agent" ||
          row.busy ||
          row.closed
        )
          continue;
        try {
          await check(row, {
            phase: "catalog",
            ownerId: input.ownerId,
            runId: input.runId,
            sessionId: row.sessionId,
            actor: "agent",
            epoch: input.epoch,
            stepId: input.stepId,
            inputHash: input.inputHash,
          });
          output.push({
            action: "browser_interact",
            sessionId: row.sessionId,
            operations: ["snapshot", "navigate", "click", "scroll"],
            description:
              "Read-only interactive browser. Each operation needs approval. Use a snapshot view/target for clicks. Owner takeover is required for credentials and writes.",
          });
        } catch {
          /* Missing authority reveals no session. */
        }
      }
      return output;
    },
    validate: validateBrowserAction,
    async execute(input, { signal }) {
      const approval = input.approval;
      if (!approval || approval.status !== "approved" || approval.expiresAt <= Date.now()) fail();
      const operation = validateBrowserAction(approval.action, JSON.parse(approval.canonicalInput));
      if (
        canonicalWorkInput(operation) !== approval.canonicalInput ||
        (await workInputHash(operation)) !== approval.inputHash
      )
        fail();
      const row = sessions.get(operation.sessionId);
      if (
        !row ||
        row.ownerId !== input.ownerId ||
        row.runId !== input.runId ||
        row.mode !== "agent"
      )
        fail();
      return store.withOwnerLock(input.ownerId, async () => {
        if (row.busy || row.closed) fail();
        const binding = {
          phase: "admit_agent",
          ownerId: input.ownerId,
          runId: input.runId,
          sessionId: row.sessionId,
          actor: "agent",
          epoch: input.epoch,
          stepId: input.stepId,
          inputHash: input.inputHash,
          approvalId: approval.id,
        };
        const grant = await check(row, binding, signal);
        const result = await run(
          row,
          { ...operation, actor: "agent", sequence: grant.sequence },
          { ...binding, phase: "check", sequence: grant.sequence },
          signal,
        );
        return { outcome: "completed", result };
      });
    },
    async closeOwner(ownerId) {
      return store.withOwnerLock(
        ownerId,
        async () => {
          for (const row of sessions.values()) if (row.ownerId === ownerId) await close(row);
          await factory.closeOwner(ownerId);
        },
        true,
      );
    },
    async close() {
      for (const row of sessions.values()) await close(row);
    },
  };
}
export function withBrowserActions(ordinary, browser) {
  if (!browser) return ordinary;
  return {
    catalog: async (input) => [
      ...(await ordinary.catalog(input)),
      ...(await browser.catalog(input)),
    ],
    validate: (action, input) =>
      action === "browser_interact"
        ? browser.validate(action, input)
        : ordinary.validate(action, input),
    execute: (input, options) =>
      input.approval?.action === "browser_interact"
        ? browser.execute(input, options)
        : ordinary.execute(input, options),
  };
}
