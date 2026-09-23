import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";

const owner = "10000000-0000-4000-8000-000000000001";
const resource = "20000000-0000-4000-8000-000000000002";
function fixture(owned) {
  let generation = 0;
  const observers = new Set(),
    ownedInputs = [],
    legacyChannels = [],
    removed = [];
  const events = { refresh: 0, ownedStopped: 0, lifecycleStopped: 0 };
  const realtime = {
    channel(topic) {
      const channel = {
        topic,
        filters: [],
        on(type, filter, callback) {
          this.filters.push({ type, filter, callback });
          return this;
        },
        subscribe(callback) {
          this.status = callback;
          return this;
        },
      };
      legacyChannels.push(channel);
      return channel;
    },
    async removeChannel(channel) {
      removed.push(channel);
    },
  };
  const facades = {
    auth: { getSession: async () => ({ data: { session: null } }) },
    get realtime() {
      assert.equal(owned, false, "owned subscription cannot create a hosted channel");
      return realtime;
    },
  };
  const h = reactFixture(
    "src/lib/collaboration.ts",
    (m) => () =>
      m.useCollaborationPresence({
        kind: "project",
        id: resource,
        userId: owner,
        onRefresh: async () => events.refresh++,
      }),
    {
      modules: {
        zod: { z },
        "@/integrations/supabase/client": {
          supabase: facades,
          getSupabaseClientConfigStatus: () => ({ configured: true }),
        },
        "@/integrations/supabase/config": { SUPABASE_BROWSER_CONFIG: {} },
        "./kova-auth-browser": {
          isKovaSessionActive: () => owned,
          kovaAuthGeneration: () => generation,
          subscribeKovaAuthChanges: (fn) => {
            observers.add(fn);
            return () => observers.delete(fn);
          },
        },
        "./kova-auth-realtime": {
          subscribeOwnedRealtime: (input) => {
            ownedInputs.push(input);
            return () => events.ownedStopped++;
          },
        },
        "./collaboration-client.mjs": {
          createCollaborationClient: () => {},
          createCollaborationLifecycle: (input) => {
            const stop = input.subscribe(() => events.refresh++, input.onStatus);
            return () => {
              events.lifecycleStopped++;
              stop();
            };
          },
        },
      },
      globals: { crypto },
    },
  );
  return {
    ...h,
    events,
    ownedInputs,
    legacyChannels,
    removed,
    observers,
    change(nextOwned) {
      owned = nextOwned;
      generation++;
      for (const fn of [...observers]) fn();
    },
  };
}

test("the real collaboration hook selects owned leases with the captured owner and only RLS-protected invalidation filters", async () => {
  const f = fixture(true);
  await f.flush();
  assert.equal(f.ownedInputs.length, 1);
  assert.equal(f.ownedInputs[0].ownerId, owner);
  assert.equal(f.legacyChannels.length, 0);
  const bindings = [];
  f.ownedInputs[0].bind({ on: (...args) => bindings.push(args) }, () => {});
  assert.equal(bindings.length, 6);
  assert.ok(
    bindings.every(
      ([type, filter]) =>
        type === "postgres_changes" && ["INSERT", "UPDATE"].includes(filter.event),
    ),
  );
  assert.deepEqual(
    [...new Set(bindings.map(([, filter]) => filter.table))],
    ["project_notes", "project_comments", "collaboration_presence"],
  );
  f.change(true);
  await f.flush();
  assert.equal(f.events.ownedStopped, 1, "old auth generation is closed before re-subscription");
  assert.equal(f.ownedInputs.length, 2);
  f.unmount();
  assert.equal(f.events.ownedStopped, 2);
  assert.equal(f.observers.size, 0);
});

test("a real dual-mode hook closes the captured legacy client before adopting owned authority", async () => {
  const f = fixture(false);
  await f.flush();
  const channel = f.legacyChannels[0];
  assert.equal(channel.filters.length, 6);
  channel.filters[0].callback();
  assert.equal(f.events.refresh, 1);
  f.change(true);
  channel.filters[0].callback();
  channel.status("SUBSCRIBED");
  assert.equal(f.events.refresh, 1, "queued hosted frames cannot reach a changed account");
  assert.deepEqual(
    f.removed,
    [channel],
    "cleanup uses the original socket rather than the now-owned facade",
  );
  await f.flush();
  assert.equal(f.ownedInputs.length, 1);
  f.unmount();
  assert.equal(f.observers.size, 0);
  assert.equal(f.events.ownedStopped, 1);
});

test("legacy-only cleanup remains idempotent and rejects post-unmount frames", async () => {
  const f = fixture(false);
  await f.flush();
  const channel = f.legacyChannels[0];
  f.unmount();
  channel.filters[0].callback();
  channel.status("SUBSCRIBED");
  assert.equal(f.events.refresh, 0);
  assert.deepEqual(f.removed, [channel]);
  assert.equal(f.observers.size, 0);
});
