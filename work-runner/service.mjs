import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  canonicalWorkInput,
  workInputHash,
  workUuid,
  WORK_RUNNER_CAPABILITIES,
  WORK_EXECUTION_PROTOCOL,
} from "../src/lib/work-execution-protocol.mjs";
import { signRunnerEnvelope } from "../src/lib/work-runner-transport.mjs";

/** Authenticated runner service. Task code is delegated only to the isolated adapter. */
export function createWorkRunnerService({
  configuration,
  store,
  provider,
  render,
  notify,
  readiness,
  concurrency = 2,
  browser,
}) {
  if (
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 8 ||
    typeof readiness !== "function"
  )
    throw new Error("work_service_configuration_invalid");
  const active = new Map(),
    operations = new Map();
  const equal = (a, b) =>
    typeof a === "string" &&
    typeof b === "string" &&
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b));
  async function response(request, payload, status = 200) {
    const raw = JSON.stringify({
      protocol: WORK_EXECUTION_PROTOCOL,
      runnerId: configuration.id,
      build: configuration.build,
      requestId: request.requestId,
      at: Date.now(),
      payload,
    });
    return new Response(raw, {
      status,
      headers: {
        "Content-Type": "application/json",
        "X-Kova-Signature": await signRunnerEnvelope(configuration.signingKey, "response", raw),
      },
    });
  }
  const binding = (input) => ({
    runId: workUuid(input.runId),
    ownerId: workUuid(input.ownerId),
    epoch: input.epoch,
    stepId: workUuid(input.stepId),
    inputHash: input.inputHash,
  });
  const publicRecord = (row) => {
    const { artifacts, privateInput, ...safe } = row;
    void artifacts;
    void privateInput;
    return safe;
  };
  async function serialized(id, fn) {
    const previous = operations.get(id) ?? Promise.resolve();
    const next = previous.then(fn);
    const settled = next.catch(() => undefined);
    operations.set(id, settled);
    try {
      return await next;
    } finally {
      if (operations.get(id) === settled) operations.delete(id);
    }
  }
  async function start(input) {
    const key = store.key(input);
    return serialized(key, async () => {
      if (await store.ownerRetired(input.ownerId)) throw new Error("work_owner_retired");
      const previous = await store.get(input);
      if (previous) {
        if (previous.inputHash !== input.inputHash || previous.ownerId !== input.ownerId)
          throw new Error("work_attempt_conflict");
        return publicRecord(previous);
      }
      if (active.size >= concurrency) throw new Error("work_runner_capacity");
      const row = { ...binding(input), attemptId: randomUUID(), status: "accepted" };
      const controller = new AbortController();
      active.set(key, { controller, ownerId: input.ownerId });
      try {
        const created = await store.create(input, row);
        if (!created.created) {
          active.delete(key);
          if (
            Object.entries(binding(input)).some(([name, value]) => created.value?.[name] !== value)
          )
            throw new Error("work_attempt_conflict");
          return publicRecord(created.value);
        }
      } catch (error) {
        active.delete(key);
        throw error;
      }
      void (async () => {
        await store.withOwnerLock(input.ownerId, async () => {
          try {
            if (await store.ownerRetired(input.ownerId)) throw new Error("work_owner_retired");
            const running = await store.put(input, { ...row, status: "running" });
            // Another instance may have cancelled after durable acceptance.
            // The locked write returns the actual state, never our stale draft.
            if (running.status !== "running" || controller.signal.aborted) return;
            const result = await provider.reason(input, {
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]),
              render,
            });
            if (
              ![
                "completed",
                "question",
                "approval_required",
                "effect_completed",
                "failed",
              ].includes(result.status)
            )
              throw new Error("work_provider_status_invalid");
            const receipt = { ...result.receipt, ...binding(input) };
            // Serializing cancellation and publication prevents a late completion
            // from overwriting the durable cancellation acknowledgement.
            await serialized(key, async () => {
              const current = await store.get(input);
              await store.put(input, {
                ...row,
                status: current?.status === "cancelled" ? "cancelled" : result.status,
                receipt,
                artifacts: result.artifacts ?? [],
              });
            });
          } catch {
            if (!(await store.ownerRetired(input.ownerId)))
              await serialized(key, async () => {
                const current = await store.get(input);
                if (current?.status !== "cancelled")
                  await store.put(input, { ...row, status: "unknown" });
              });
          } finally {
            active.delete(key);
          }
        });
      })().catch(() => {
        active.delete(key);
      });
      return publicRecord(row);
    });
  }
  return {
    async handle(httpRequest) {
      let request;
      try {
        if (
          httpRequest.method !== "POST" ||
          httpRequest.headers.get("content-type")?.split(";", 1)[0] !== "application/json" ||
          !equal(httpRequest.headers.get("authorization"), `Bearer ${configuration.token}`)
        )
          return new Response(null, { status: 401 });
        const reader = httpRequest.body?.getReader();
        if (!reader) return new Response(null, { status: 400 });
        let raw = "",
          size = 0;
        const decoder = new TextDecoder("utf-8", { fatal: true });
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.length;
            if (size > 32768) {
              await reader.cancel();
              return new Response(null, { status: 413 });
            }
            raw += decoder.decode(part.value, { stream: true });
          }
          raw += decoder.decode();
        } finally {
          reader.releaseLock();
        }
        if (
          !equal(
            httpRequest.headers.get("x-kova-signature"),
            await signRunnerEnvelope(configuration.signingKey, "request", raw),
          )
        )
          return new Response(null, { status: 401 });
        request = JSON.parse(raw);
        if (
          request.protocol !== WORK_EXECUTION_PROTOCOL ||
          request.runnerId !== configuration.id ||
          request.build !== configuration.build ||
          !Number.isSafeInteger(request.at) ||
          Math.abs(Date.now() - request.at) > 15000 ||
          new URL(httpRequest.url).pathname !== `/v1/work/${request.operation}`
        )
          return new Response(null, { status: 401 });
        workUuid(request.requestId);
        const input = request.payload;
        if (request.operation === "heartbeat") {
          if (!(await readiness())) return response(request, { status: "unavailable" }, 503);
          return response(request, {
            status: "ready",
            protocol: WORK_EXECUTION_PROTOCOL,
            capabilities: [...WORK_RUNNER_CAPABILITIES],
            modelCapabilities: provider.modelCapabilities ?? [],
            browserCapabilities: browser?.capabilities ?? null,
            heartbeatAt: Date.now(),
            expiresAt: Date.now() + 45000,
          });
        }
        if (request.operation === "dispatch") {
          workUuid(input.runId);
          workUuid(input.ownerId);
          if (!/^[a-f0-9]{64}$/.test(input.requestHash) || !(await readiness()))
            throw new Error("invalid");
          void notify("dispatch", input.runId).catch(() => undefined);
          return response(request, { ...input, status: "accepted", durable: true });
        }
        if (request.operation === "owner_cleanup") {
          const ownerId = workUuid(input.ownerId);
          if (Object.keys(input).length !== 1) throw new Error("invalid");
          const running = [...active.values()].filter((entry) => entry.ownerId === ownerId);
          for (const entry of running) entry.controller.abort();
          await store.retireOwner(ownerId);
          if (running.length) return response(request, { ownerId, status: "draining" });
          await browser?.closeOwner(ownerId);
          await store.purgeOwner(ownerId);
          return response(request, { ownerId, status: "clean", retired: true });
        }
        if (request.operation === "browser") {
          if (!browser || !(await readiness())) throw new Error("work_browser_unavailable");
          return response(request, await browser.command(input, httpRequest.signal));
        }
        const bound = binding(input);
        if (
          !Number.isSafeInteger(bound.epoch) ||
          bound.epoch < 1 ||
          !/^[a-f0-9]{64}$/.test(bound.inputHash)
        )
          throw new Error("invalid");
        if (request.operation === "submit") {
          const { inputHash, ...unsigned } = input;
          if ((await workInputHash(unsigned)) !== inputHash) throw new Error("input_hash_invalid");
          const fields = [
            "runId",
            "ownerId",
            "epoch",
            "stepId",
            "reservationId",
            "model",
            "reasoningEffort",
            "objective",
            "sessionContext",
            "directions",
            "answer",
            "maxTokens",
            "maxOutputTokens",
            "maxCostMicros",
            "approval",
            "effectResult",
          ];
          if (
            Object.keys(unsigned).some((name) => !fields.includes(name)) ||
            typeof input.model !== "string" ||
            typeof input.objective !== "string" ||
            input.objective.length > 12000 ||
            !Array.isArray(input.directions) ||
            input.directions.length > 20 ||
            !Number.isSafeInteger(input.maxOutputTokens) ||
            input.maxOutputTokens < 1 ||
            input.maxOutputTokens > input.maxTokens ||
            !Number.isSafeInteger(input.maxTokens) ||
            input.maxTokens < 1 ||
            input.maxTokens > 500000 ||
            !Number.isSafeInteger(input.maxCostMicros) ||
            input.maxCostMicros < 1
          )
            throw new Error("input_invalid");
          workUuid(input.reservationId);
          if (input.approval) {
            const approval = input.approval;
            workUuid(approval.id);
            if (
              approval.status !== "approved" ||
              !Number.isSafeInteger(approval.expiresAt) ||
              approval.expiresAt <= Date.now() ||
              typeof approval.canonicalInput !== "string" ||
              approval.canonicalInput !== canonicalWorkInput(JSON.parse(approval.canonicalInput)) ||
              (await workInputHash(JSON.parse(approval.canonicalInput))) !== approval.inputHash
            )
              throw new Error("approval_invalid");
          }
          return response(request, await start(input));
        }
        if (request.operation === "seal_undispatched") {
          const reservationId = workUuid(input.reservationId);
          if (
            Object.keys(input).some(
              (key) => ![...Object.keys(bound), "reservationId"].includes(key),
            )
          )
            throw new Error("binding_invalid");
          return serialized(store.key(input), async () => {
            if (await store.ownerRetired(bound.ownerId)) throw new Error("work_owner_retired");
            const current = await store.get(input);
            if (current) {
              if (Object.entries(bound).some(([key, value]) => current[key] !== value))
                throw new Error("binding_invalid");
              if (
                current.status === "not_executed" &&
                current.receipt?.reservationId !== reservationId
              )
                throw new Error("binding_invalid");
              // A durable accepted/running/unknown attempt can have reached the
              // provider. Its absence of a receipt never proves zero execution.
              return response(request, publicRecord(current));
            }
            const tombstone = {
              ...bound,
              attemptId: randomUUID(),
              status: "not_executed",
              receipt: {
                ...bound,
                reservationId,
                inputTokens: 0,
                outputTokens: 0,
                cachedInputTokens: 0,
                reasoningTokens: 0,
                latencyMs: 0,
                costMicros: 0,
                outputs: [],
              },
            };
            const created = await store.create(input, tombstone);
            const saved = created.value;
            if (
              Object.entries(bound).some(([name, value]) => saved?.[name] !== value) ||
              (saved.status === "not_executed" && saved.receipt?.reservationId !== reservationId)
            )
              throw new Error("binding_invalid");
            return response(request, publicRecord(saved));
          });
        }
        const row = await store.get(input);
        if (!row) return response(request, { ...bound, status: "unknown" });
        if (Object.entries(bound).some(([name, value]) => row[name] !== value))
          throw new Error("binding_invalid");
        if (request.operation === "cancel")
          return serialized(store.key(input), async () => {
            const current = await store.get(input);
            if (["accepted", "running"].includes(current.status)) {
              active.get(store.key(input))?.controller.abort();
              await store.put(input, { ...current, status: "cancelled" });
              return response(request, { ...publicRecord(current), status: "cancelled" });
            }
            return response(request, publicRecord(current));
          });
        if (request.operation === "artifact") {
          const artifact = row.artifacts?.find((item) => item.artifactId === input.artifactId);
          if (!artifact) throw new Error("artifact_missing");
          return response(request, { ...bound, ...artifact });
        }
        if (!["status", "reconcile"].includes(request.operation))
          throw new Error("operation_invalid");
        return serialized(store.key(input), async () => {
          // Read completion state while serialized with receipt publication. A
          // stale running snapshot followed by active.delete is not crash proof.
          const current = await store.get(input);
          if (!current || Object.entries(bound).some(([name, value]) => current[name] !== value))
            throw new Error("binding_invalid");
          return response(request, {
            ...publicRecord(current),
            ...(["accepted", "running"].includes(current.status) && !active.has(store.key(input))
              ? { status: "unknown" }
              : {}),
          });
        });
      } catch {
        return request
          ? response(request, { error: "work_runner_request_failed" }, 409)
          : new Response(null, { status: 400 });
      }
    },
    async drain() {
      await notify("drain", null);
    },
    close() {
      for (const entry of active.values()) entry.controller.abort();
    },
  };
}
