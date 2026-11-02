import { randomUUID } from "node:crypto";

// Interaction handles stay inside this session. Only bounded descriptions and
// opaque, snapshot-scoped controls leave the driver; prompt values never do.
export function createBrowserInteractions() {
  const queue = [],
    listeners = new Set();
  const wake = () => {
    for (const listener of listeners) listener();
  };
  return {
    get pending() {
      return queue[0] ?? null;
    },
    get size() {
      return queue.length;
    },
    add(value) {
      if (queue.length >= 3 || !["dialog", "popup"].includes(value.kind)) return null;
      const row = { ...value, id: randomUUID() };
      queue.push(row);
      wake();
      return row.id;
    },
    remove(id) {
      const index = queue.findIndex((row) => row.id === id);
      if (index >= 0) queue.splice(index, 1);
    },
    describe(actor) {
      const row = queue[0];
      if (!row) return null;
      const controls = new Map();
      const nodes =
        actor === "owner"
          ? ["allow", "deny"].map((action) => {
              const id = randomUUID();
              controls.set(id, { interactionId: row.id, action });
              return {
                id,
                label:
                  action === "deny"
                    ? "Not now"
                    : row.kind === "popup"
                      ? "Open popup once"
                      : "Continue once",
                kind: `interaction_${action}`,
                inputType: "",
                editable: false,
                disabled: false,
              };
            })
          : [];
      return {
        handoff: row.kind,
        interaction: {
          kind: row.kind,
          origin: row.origin,
          message: row.message.slice(0, 1000),
          ...(row.prompt ? { prompt: true } : {}),
        },
        nodes,
        controls,
      };
    },
    async respond(id, action, text) {
      const row = queue[0];
      if (
        !row ||
        row.id !== id ||
        !["allow", "deny"].includes(action) ||
        (text !== undefined &&
          (!row.prompt ||
            action !== "allow" ||
            typeof text !== "string" ||
            text.length > 4000 ||
            text.includes("\0")))
      )
        throw Error("work_browser_interaction_stale");
      // Consume once before browser continuation; an ambiguous response is not replayed.
      queue.shift();
      await (action === "allow" ? row.allow(text ?? "") : row.deny());
    },
    async during(action) {
      let listener;
      const interrupted = new Promise((resolve) => {
        listener = resolve;
        listeners.add(listener);
      });
      try {
        return await Promise.race([Promise.resolve().then(action), interrupted]);
      } finally {
        listeners.delete(listener);
      }
    },
    clear() {
      queue.length = 0;
      listeners.clear();
    },
  };
}
