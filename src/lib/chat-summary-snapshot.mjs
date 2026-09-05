import { deriveTitle } from "./chat-store.ts";
import { boundedSummaryText } from "./chat-summary-text.mjs";
import { enqueueMemoryWrite } from "./memory-write-coordinator.mjs";

async function digestMessages(messages) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      messages: messages.map(({ role, content }) => ({ role, content })),
    }),
  );
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function verifiedBase(messages, start, descriptor) {
  const count = descriptor?.completed_count;
  if (
    !descriptor ||
    descriptor.completed_start !== start ||
    !Number.isSafeInteger(count) ||
    count < 4 ||
    start + count > messages.length - 12 ||
    typeof descriptor.id !== "string"
  )
    return null;
  const digest = await digestMessages(messages.slice(start, start + count));
  return digest === descriptor.completed_digest
    ? { id: descriptor.id, start, count, digest }
    : null;
}

/** Hash the complete eligible prefix, but queue at most 88 new excerpts. */
export async function createChatSummarySnapshot(messages, memoryStartIndex = 0, descriptor = null) {
  if (
    !Array.isArray(messages) ||
    !Number.isSafeInteger(memoryStartIndex) ||
    memoryStartIndex < 0 ||
    memoryStartIndex > messages.length ||
    messages.length > 1000000
  )
    return null;
  const target = messages.length - 12 - memoryStartIndex;
  if (target < 4) return null;
  const base = await verifiedBase(messages, memoryStartIndex, descriptor);
  const baseCount = base?.count ?? 0;
  const count = Math.min(target, baseCount + 88);
  if (count <= baseCount) return null;
  const prefix = messages.slice(memoryStartIndex, memoryStartIndex + count);
  if (
    prefix.some(
      (message) =>
        !message ||
        !["user", "assistant"].includes(message.role) ||
        typeof message.content !== "string",
    )
  )
    return null;
  return {
    start: memoryStartIndex,
    count,
    digest: await digestMessages(prefix),
    messages: prefix
      .slice(baseCount)
      .map(({ role, content }) => ({ role, content: boundedSummaryText(content, 256) })),
    ...(base ? { baseCount, baseDigest: base.digest, baseId: base.id } : {}),
  };
}

export async function createMemoryWritePayload(active, descriptor = null) {
  if (!active || active.temporary || !Array.isArray(active.messages)) return null;
  const memoryStartIndex = active.memoryStartIndex ?? 0;
  if (
    !Number.isSafeInteger(memoryStartIndex) ||
    memoryStartIndex < 0 ||
    memoryStartIndex > active.messages.length
  )
    return null;
  const memoryMessages = active.messages.slice(memoryStartIndex);
  if (memoryMessages.length < 4) return null;
  const memoryTitle = deriveTitle(
    memoryMessages.find((message) => message.role === "user")?.content ?? "Saved chat",
  );
  return {
    chatId: active.id,
    title: memoryTitle.slice(0, 120),
    memoryEnabled: true,
    temporary: false,
    messages: memoryMessages
      .slice(-30)
      .map((message) => ({ role: message.role, content: message.content.slice(0, 2000) })),
    contextSummary: await createChatSummarySnapshot(active.messages, memoryStartIndex, descriptor),
  };
}

async function sessionFor(principal, dependencies) {
  const getSession =
    dependencies.getSession ??
    (async () => {
      const { supabase, getSupabaseClientConfigStatus } =
        await import("../integrations/supabase/client");
      if (!getSupabaseClientConfigStatus().configured) return { data: { session: null } };
      return supabase.auth.getSession();
    });
  const { data } = await getSession();
  const session = data?.session;
  return session?.user?.id === principal && session.access_token ? session : null;
}

async function descriptorFor(chatId, session, dependencies, timeoutMs = 5000) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(chatId) || !session)
    return { enabled: false, descriptor: null };
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = dependencies.signal ? AbortSignal.any([dependencies.signal, deadline]) : deadline;
  const response = await (dependencies.fetchImpl ?? fetch)(
    `/api/memory?contextChatId=${encodeURIComponent(chatId)}`,
    {
      credentials: "omit",
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal,
    },
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("memory_descriptor_unavailable");
  }
  const value = await response.json();
  return value?.enabled === true ? value : { enabled: false, descriptor: null };
}

/** Keep a delayed snapshot and its token bound to the account that scheduled it. */
export async function writeMemoryForPrincipal(active, principal, dependencies = {}) {
  if (typeof principal !== "string" || !principal) return { continue: false };
  const session = await sessionFor(principal, dependencies);
  if (!session) return { continue: false };
  const state = await descriptorFor(active.id, session, dependencies);
  const payload = await createMemoryWritePayload(active, state.enabled ? state.descriptor : null);
  if (!payload || dependencies.signal?.aborted) return { continue: false };
  if (!state.enabled) payload.contextSummary = null;
  const snapshot = payload.contextSummary;
  const unchanged =
    state.descriptor?.requested_digest === snapshot?.digest &&
    state.descriptor?.requested_start === snapshot?.start;
  const failed = unchanged && state.descriptor?.status === "failed";
  const needsMore = state.enabled && Boolean(snapshot) && !failed;
  if (unchanged) payload.contextSummary = null;
  if (dependencies.contextOnly && !payload.contextSummary) return { continue: needsMore };
  const response = await (dependencies.fetchImpl ?? fetch)("/api/memory", {
    method: "POST",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      ...payload,
      ...(dependencies.contextOnly ? { contextOnly: true } : {}),
    }),
    signal: dependencies.signal,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("memory_write_failed");
  }
  await response.body?.cancel().catch(() => undefined);
  return { continue: needsMore };
}

/** Catch up incrementally while this conversation remains open and consented. */
export function startMemoryWrites(active, principal) {
  const controller = new AbortController();
  let timer;
  let stopped = false;
  let first = true;
  let failures = 0;
  const step = async () => {
    let more = false;
    try {
      const outcome = await enqueueMemoryWrite({
        principal,
        run: async () => {
          const contextOnly = !first;
          first = false;
          const result = await writeMemoryForPrincipal(active, principal, {
            contextOnly,
            signal: controller.signal,
          });
          more = result.continue;
        },
      });
      if (outcome === "skipped") return;
      failures = 0;
    } catch {
      more = true;
      failures++;
    }
    if (!stopped && more)
      timer = setTimeout(step, Math.min(60000, 15000 * 2 ** Math.min(failures, 2)));
  };
  void step();
  return () => {
    stopped = true;
    clearTimeout(timer);
    controller.abort();
  };
}

export function scheduleMemoryWrites(active, principal, signal) {
  if (signal.aborted || active.messages.length - (active.memoryStartIndex ?? 0) < 4) return;
  let cancel;
  const timer = setTimeout(() => {
    if (!signal.aborted) cancel = startMemoryWrites(active, principal);
  }, 4000);
  signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      cancel?.();
    },
    { once: true },
  );
}

export async function fetchForPrincipal(principal, input, init = {}, dependencies = {}) {
  const headers = new Headers(init.headers);
  headers.delete("Authorization");
  if (principal) {
    const session = await sessionFor(principal, dependencies);
    if (!session) throw new DOMException("Account changed before request", "AbortError");
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }
  return (dependencies.fetchImpl ?? fetch)(input, { ...init, credentials: "omit", headers });
}

/** Preserve the archive; only the bounded transport window is shortened. */
export async function createChatHistoryPayload(messages, memoryStartIndex = 0, options = {}) {
  const historyOffset = Math.max(0, messages.length - 100);
  const payload = { messages: messages.slice(historyOffset), historyOffset, memoryStartIndex };
  if (options.temporary || !options.memoryEnabled || !options.principal || !options.chatId)
    return payload;
  try {
    const session = await sessionFor(options.principal, options);
    const state = await descriptorFor(options.chatId, session, options, 2000);
    if (state.enabled) {
      const proof = await verifiedBase(messages, memoryStartIndex, state.descriptor);
      if (proof) payload.summaryProof = proof;
    }
  } catch {
    /* Recent chat remains usable if optional summary metadata is unavailable. */
  }
  return payload;
}
