import { readResponseBytesBounded } from "./endpoint-reliability.mjs";
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const string = (value, max = 1000) => (typeof value === "string" ? value.slice(0, max) : "");
const id = (value) => typeof value === "string" && /^[a-f0-9]{1,80}$/iu.test(value);
const historyId = (value) => typeof value === "string" && /^\d{1,30}$/u.test(value);
const email = (value) => {
  const input = string(value, 1000),
    angle = input.match(/<([^<>\s@]+@[^<>\s@]+)>/u);
  const result = angle?.[1] ?? input.trim();
  return /^[^\s<>@]+@[^\s<>@]+$/u.test(result) ? result.toLowerCase() : "";
};
export class TaskEventAccessError extends Error {
  constructor() {
    super("task_event_access_revoked");
  }
}
export class TaskEventNotFoundError extends TaskEventAccessError {}
export class TaskEventResyncError extends Error {
  constructor() {
    super("task_event_resync_required");
  }
}
export function createTaskEventRuntime({ rpc, admit, getToken, checkCurrent, fetchImpl = fetch }) {
  async function json(url, token, signal, init = {}) {
    const response = await fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    });
    if (response.status === 404) throw new TaskEventNotFoundError();
    if ([401, 403].includes(response.status)) throw new TaskEventAccessError();
    if (!response.ok) throw new Error("task_event_provider_unavailable");
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await readResponseBytesBounded(response, 128000, { signal, timeoutMs: 5000 }),
      ),
    );
    return object(value);
  }
  async function checkedJson(grant, url, token, signal, init = {}) {
    await checkCurrent(grant, signal);
    return json(url, token, signal, init);
  }
  async function normalize(item, grant, signal) {
    const token = await getToken(grant, signal),
      ref = object(item.reference);
    if (grant.provider === "slack") {
      if (
        !/^[CG][A-Z0-9]{8,30}$/u.test(item.resource) ||
        !/^\d{10}\.\d{6}$/u.test(ref.ts) ||
        grant.provider_account_id.split(":")[0] !== item.scope_key
      )
        throw new TaskEventAccessError();
      const conversation = await checkedJson(
        grant,
        `https://slack.com/api/conversations.info?channel=${encodeURIComponent(item.resource)}`,
        token,
        signal,
      );
      const channel = object(conversation.channel);
      if (
        conversation.ok !== true ||
        channel.id !== item.resource ||
        typeof channel.is_private !== "boolean" ||
        (channel.is_private &&
          (!grant.required_scopes.includes("groups:history") ||
            !grant.required_scopes.includes("groups:read")))
      )
        throw new TaskEventAccessError();
      const params = new URLSearchParams({
        channel: item.resource,
        oldest: ref.ts,
        latest: ref.ts,
        inclusive: "true",
        limit: "2",
      });
      const method =
        ref.threadTs && ref.threadTs !== ref.ts ? "conversations.replies" : "conversations.history";
      if (method.endsWith("replies")) params.set("ts", ref.threadTs);
      const result = await checkedJson(
        grant,
        `https://slack.com/api/${method}?${params}`,
        token,
        signal,
      );
      if (result.ok !== true) {
        if (
          [
            "channel_not_found",
            "not_in_channel",
            "missing_scope",
            "invalid_auth",
            "token_revoked",
          ].includes(result.error)
        )
          throw new TaskEventAccessError();
        throw new Error("task_event_provider_unavailable");
      }
      const message = (Array.isArray(result.messages) ? result.messages : [])
        .map(object)
        .find((row) => row.ts === ref.ts);
      if (!message || message.subtype || message.bot_id || !/^\w{1,40}$/u.test(message.user ?? ""))
        throw new TaskEventAccessError();
      return {
        resource: grant.trigger_resource,
        author: message.user,
        title: string(message.text, 1000),
        text: string(message.text, 6000),
        isReply: Boolean(ref.threadTs && ref.threadTs !== ref.ts),
        occurredAt: item.occurred_at,
        source: { provider: "slack", channel: item.resource, ts: ref.ts },
      };
    }
    if (
      grant.provider !== "github" ||
      !Number.isInteger(ref.pullNumber) ||
      ref.pullNumber < 1 ||
      ref.pullNumber > 999999999 ||
      !/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/u.test(item.resource) ||
      item.resource.split("/").some((part) => part === "." || part === "..")
    )
      throw new TaskEventAccessError();
    const pull = await checkedJson(
      grant,
      `https://api.github.com/repos/${item.resource}/pulls/${ref.pullNumber}`,
      token,
      signal,
    );
    if (
      pull.number !== ref.pullNumber ||
      string(object(object(pull.base).repo).full_name).toLowerCase() !== item.resource.toLowerCase()
    )
      throw new TaskEventAccessError();
    return {
      resource: grant.trigger_resource,
      author: string(object(pull.user).login, 100),
      title: string(pull.title, 1000),
      text: string(pull.body, 6000),
      activity: ref.activity,
      labels: (Array.isArray(pull.labels) ? pull.labels : []).map((label) =>
        string(object(label).name, 100),
      ),
      occurredAt: item.occurred_at,
      source: { provider: "github", repository: item.resource, pullNumber: ref.pullNumber },
    };
  }
  async function gmail(item, grant, worker, signal) {
    let cursor = await rpc("cursor_claim", {
      userId: grant.user_id,
      grantId: grant.id,
      workerId: worker,
    });
    if (cursor.busy) return false;
    const cursorArgs = () => ({
      userId: grant.user_id,
      grantId: grant.id,
      workerId: worker,
      expectedRevision: cursor.revision,
      expectedCursorVersion: cursor.cursor_version,
    });
    try {
      const token = await getToken(grant, signal);
      let page = object(cursor.page_state);
      if (!Array.isArray(page.ids)) {
        const params = new URLSearchParams({
          startHistoryId: cursor.history_id,
          historyTypes: "messageAdded",
          labelId: "INBOX",
          maxResults: "20",
        });
        if (page.nextPageToken) {
          if (typeof page.nextPageToken !== "string" || page.nextPageToken.length > 2000)
            throw new TaskEventResyncError();
          params.set("pageToken", page.nextPageToken);
        }
        let result;
        try {
          result = await checkedJson(
            grant,
            `https://gmail.googleapis.com/gmail/v1/users/me/history?${params}`,
            token,
            signal,
          );
        } catch (error) {
          if (error instanceof TaskEventNotFoundError) throw new TaskEventResyncError();
          throw error;
        }
        if (
          !historyId(result.historyId) ||
          (result.nextPageToken != null &&
            (typeof result.nextPageToken !== "string" || result.nextPageToken.length > 2000))
        )
          throw new TaskEventResyncError();
        const ids = new Set();
        if (result.history != null && !Array.isArray(result.history))
          throw new TaskEventResyncError();
        for (const record of result.history ?? []) {
          if (object(record).messagesAdded != null && !Array.isArray(record.messagesAdded))
            throw new TaskEventResyncError();
          for (const added of object(record).messagesAdded ?? []) {
            const value = object(object(added).message).id;
            if (!id(value)) throw new TaskEventResyncError();
            ids.add(value);
          }
        }
        page = {
          ids: [...ids],
          index: 0,
          nextPageToken: result.nextPageToken ?? null,
          endHistoryId: result.historyId,
        };
        if (ids.size > 300 || new TextEncoder().encode(JSON.stringify(page)).length > 12000)
          throw new TaskEventResyncError();
        cursor = await rpc("cursor_save", {
          ...cursorArgs(),
          historyId: cursor.history_id,
          pageState: page,
        });
      }
      if (
        !Array.isArray(page.ids) ||
        page.ids.some((value) => !id(value)) ||
        !Number.isInteger(page.index) ||
        page.index < 0 ||
        page.index > page.ids.length ||
        !historyId(page.endHistoryId)
      )
        throw new TaskEventResyncError();
      for (let count = 0; count < 3 && page.index < page.ids.length; count++) {
        signal.throwIfAborted();
        const messageId = page.ids[page.index];
        let message;
        try {
          message = await checkedJson(
            grant,
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
            token,
            signal,
          );
        } catch (error) {
          if (!(error instanceof TaskEventNotFoundError)) throw error;
        }
        if (
          message &&
          message.id === messageId &&
          Array.isArray(message.labelIds) &&
          message.labelIds.includes("INBOX")
        ) {
          const headers = (
              Array.isArray(object(message.payload).headers) ? message.payload.headers : []
            ).map(object),
            header = (name) =>
              headers.find((row) => string(row.name).toLowerCase() === name)?.value;
          const occurred = Number(message.internalDate);
          if (!Number.isFinite(occurred) || occurred < 0 || occurred > Date.now() + 300000)
            throw new TaskEventResyncError();
          signal.throwIfAborted();
          await admit(grant.id, `gmail:${messageId}`, {
            resource: "inbox",
            author: email(header("from")),
            title: string(header("subject"), 1000),
            text: string(message.snippet, 2000),
            labels: message.labelIds.filter((value) => typeof value === "string"),
            occurredAt: new Date(occurred).toISOString(),
            source: { provider: "gmail", messageId },
          });
        }
        page = { ...page, index: page.index + 1 };
        cursor = await rpc("cursor_save", {
          ...cursorArgs(),
          historyId: cursor.history_id,
          pageState: page,
        });
      }
      if (page.index < page.ids.length) return false;
      cursor = await rpc("cursor_save", {
        ...cursorArgs(),
        historyId: page.nextPageToken ? cursor.history_id : page.endHistoryId,
        pageState: page.nextPageToken ? { nextPageToken: page.nextPageToken } : {},
      });
      return !page.nextPageToken;
    } catch (error) {
      if (error instanceof TaskEventResyncError) {
        await rpc("cursor_resync", cursorArgs());
        return true;
      }
      throw error;
    } finally {
      await rpc("cursor_release", cursorArgs()).catch(() => {});
    }
  }
  async function pump({ signal, limit = 10 }) {
    const worker = crypto.randomUUID();
    let processed = 0;
    while (processed < Math.max(1, Math.min(20, limit)) && !signal.aborted) {
      const item = await rpc("claim", { workerId: worker });
      if (!item) break;
      const args = { inboxId: item.id, workerId: worker };
      try {
        const grant = await rpc("target", args);
        if (!grant) {
          processed++;
          continue;
        }
        let complete = true;
        try {
          if (grant.provider === "gmail") complete = await gmail(item, grant, worker, signal);
          else {
            const event = await normalize(item, grant, signal);
            signal.throwIfAborted();
            await admit(grant.id, `${grant.provider}:${item.event_key}`, event);
          }
        } catch (error) {
          if (
            !(error instanceof TaskEventAccessError) &&
            ![
              "task_connection_unavailable",
              "google_connection_changed",
              "google_reauthorization_required",
              "task_source_unavailable",
            ].includes(error?.message)
          )
            throw error;
        }
        if (complete)
          await rpc("advance", { ...args, grantId: grant.id, resource: grant.trigger_resource });
        await rpc("release", args);
        processed++;
      } catch {
        await rpc("retry", args).catch(() => {});
        processed++;
      }
    }
    return { processed };
  }
  async function initialize(grant, { expectedRevision, watch = false, topic }, signal) {
    const token = await getToken(grant, signal);
    if (
      watch &&
      !/^projects\/[a-z][a-z0-9-]{4,62}\/topics\/[A-Za-z][A-Za-z0-9._~+%-]{2,254}$/u.test(
        topic ?? "",
      )
    )
      throw new Error("task_events_unavailable");
    let cursor;
    if (watch && expectedRevision > 0) {
      // Adding a watch preserves the explicitly established baseline and its
      // durable in-flight page; only Reset baseline may discard that history.
      cursor = await rpc("source_watch_consent", {
        userId: grant.user_id,
        grantId: grant.id,
        expectedRevision,
      });
    } else {
      const profile = await checkedJson(
        grant,
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        token,
        signal,
      );
      if (!historyId(profile.historyId) || !email(profile.emailAddress))
        throw new TaskEventResyncError();
      cursor = await rpc("source_init", {
        userId: grant.user_id,
        grantId: grant.id,
        expectedRevision,
        email: profile.emailAddress,
        historyId: profile.historyId,
        watchConsent: watch,
      });
    }
    if (watch) await renewWatch(grant, cursor, topic, signal, token);
    return { ok: true };
  }
  async function renewWatch(grant, cursor, topic, signal, token) {
    token ??= await getToken(grant, signal);
    if (
      !/^projects\/[a-z][a-z0-9-]{4,62}\/topics\/[A-Za-z][A-Za-z0-9._~+%-]{2,254}$/u.test(
        topic ?? "",
      )
    )
      throw new Error("task_events_unavailable");
    const worker = crypto.randomUUID();
    const claimed = await rpc("cursor_claim", {
      userId: grant.user_id,
      grantId: grant.id,
      workerId: worker,
    });
    if (claimed.busy) throw new Error("task_event_provider_unavailable");
    const args = {
      userId: grant.user_id,
      grantId: grant.id,
      workerId: worker,
      expectedRevision: claimed.revision,
      expectedCursorVersion: claimed.cursor_version,
    };
    try {
      if (claimed.revision !== cursor.revision || !claimed.watch_consent)
        throw new Error("task_source_conflict");
      const result = await checkedJson(
        grant,
        "https://gmail.googleapis.com/gmail/v1/users/me/watch",
        token,
        signal,
        {
          method: "POST",
          body: JSON.stringify({
            topicName: topic,
            labelIds: ["INBOX"],
            labelFilterBehavior: "include",
          }),
        },
      );
      const expires = Number(result.expiration);
      if (!Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + 8 * 86400000)
        throw new Error("task_event_provider_unavailable");
      await rpc("watch_saved", { ...args, expiresAt: new Date(expires).toISOString() });
    } finally {
      await rpc("cursor_release", args).catch(() => {});
    }
  }

  return { pump, initialize, renewWatch, normalize, gmail };
}
