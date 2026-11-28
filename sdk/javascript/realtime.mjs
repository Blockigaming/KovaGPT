// Browser-compatible client for the bounded native Realtime session protocol.
// Every execution requires a previously accepted quote; opening a socket never spends.
async function connectSession(
  grant,
  { baseURL = "https://kovagpt.com", WebSocketImpl = globalThis.WebSocket, signal } = {},
  kind = "realtime",
) {
  const url = new URL(baseURL);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    grant?.transport !== `/api/developer/${kind}/socket` ||
    grant?.protocol !== `kova.${kind}.v1` ||
    typeof grant.client_secret !== "string" ||
    !/^krt_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}$/.test(grant.client_secret)
  )
    throw Error("realtime_session_invalid");
  signal?.throwIfAborted();
  url.protocol = "wss:";
  url.pathname = grant.transport;
  const socket = new WebSocketImpl(url.href, grant.protocol);
  let pending,
    ready = false,
    closed = false;
  let resolveReady, rejectReady;
  const connecting = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const fail = (code, uncertain = false) =>
    Object.assign(Error(code), { requestMayHaveStarted: uncertain });
  const end = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", end);
    rejectReady(fail("realtime_session_closed"));
    if (pending) {
      pending.reject(fail("realtime_session_closed", pending.paid));
      pending = null;
    }
    try {
      socket.close();
    } catch {
      /* already closed */
    }
  };
  const timer = setTimeout(end, 10000);
  signal?.addEventListener("abort", end, { once: true });
  socket.addEventListener("open", () => {
    try {
      socket.send(JSON.stringify({ type: "session.authenticate", token: grant.client_secret }));
    } catch {
      end();
    }
  });
  socket.addEventListener("close", end);
  socket.addEventListener("error", end);
  socket.addEventListener("message", (event) => {
    try {
      if (typeof event.data !== "string" || event.data.length > 1400000)
        throw Error("invalid_event");
      const value = JSON.parse(event.data);
      if (!ready) {
        if (value.type !== "session.ready" || value.id !== grant.id) throw Error("invalid_session");
        ready = true;
        clearTimeout(timer);
        resolveReady();
        return;
      }
      if (!pending || value.id !== pending.id) return;
      if (
        value.type === "turn.delta" ||
        value.type === "turn.started" ||
        value.type === "turn.cancel_requested" ||
        value.type === "turn.action_accepted" ||
        value.type === "turn.action_rejected" ||
        value.type === "turn.computer_quoted" ||
        value.type === "turn.computer_proposed" ||
        value.type === "turn.computer_rejected"
      ) {
        pending.onEvent?.(value);
        return;
      }
      const job = pending;
      pending = null;
      if (value.type === "turn.quoted" && !job.paid) job.resolve(value.quote);
      else if (value.type === "turn.completed" && job.paid) job.resolve(value.result);
      else
        job.reject(
          fail(
            typeof value.code === "string" && /^developer_[a-z_]+$/.test(value.code)
              ? value.code
              : "realtime_turn_failed",
            job.paid,
          ),
        );
    } catch {
      end();
    }
  });
  await connecting;
  function request(type, fields, paid, onEvent) {
    if (closed || pending) return Promise.reject(fail("realtime_session_busy_or_closed"));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      pending = { id, resolve, reject, paid, onEvent };
      try {
        socket.send(JSON.stringify({ type, id, ...fields }));
      } catch {
        end();
      }
    });
  }
  return {
    id: grant.id,
    get closed() {
      return closed;
    },
    quote: (input) => request("turn.quote", { input }, false),
    execute: (input, { quoteToken, requestKey, onEvent } = {}) => {
      if (
        typeof quoteToken !== "string" ||
        !quoteToken ||
        typeof requestKey !== "string" ||
        !requestKey
      )
        return Promise.reject(fail("budget_required"));
      return request(
        "turn.create",
        { input, quote_token: quoteToken, request_key: requestKey },
        true,
        onEvent,
      );
    },
    quoteComputer(command) {
      if (kind !== "browser" || closed || !pending?.paid) throw fail("browser_session_closed");
      socket.send(JSON.stringify({ type: "turn.computer_quote", id: pending.id, command }));
    },
    proposeComputer(command) {
      if (kind !== "browser" || closed || !pending?.paid || command?.approved !== true)
        throw fail("budget_required");
      socket.send(JSON.stringify({ type: "turn.computer_propose", id: pending.id, command }));
    },
    act(command) {
      if (kind !== "browser" || closed || !pending?.paid || command?.approved !== true)
        throw fail("browser_action_requires_confirmation");
      try {
        socket.send(JSON.stringify({ type: "turn.action", id: pending.id, command }));
      } catch {
        end();
        throw fail("browser_session_closed", true);
      }
    },
    cancel() {
      if (pending && !closed) {
        try {
          socket.send(JSON.stringify({ type: "turn.cancel", id: pending.id }));
        } catch {
          end();
        }
      }
    },
    close() {
      if (!closed) {
        try {
          socket.send(JSON.stringify({ type: "session.close" }));
        } catch {
          /* transport lost */
        }
        end();
      }
    },
  };
}

export function connectRealtimeSession(grant, options) {
  return connectSession(grant, options, "realtime");
}
export function connectBrowserSession(grant, options) {
  return connectSession(grant, options, "browser");
}
