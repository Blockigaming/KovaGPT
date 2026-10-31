import assert from "node:assert/strict";
import test from "node:test";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";
import { deferred } from "../helpers/ui-state-harness.mjs";
import { publicShareSnapshot } from "../../src/lib/public-chat-share-policy.mjs";

function fixture() {
  let owner = "owner-a";
  const props = {
    open: true,
    conversation: {
      id: "a",
      title: "Review",
      messages: [{ role: "user", content: "Visible text" }],
    },
    onOpenChange() {},
  };
  const requests = [],
    copies = [];
  const f = reactFixture(
    "src/components/ShareChatDialog.tsx",
    (module) => () => module.ShareChatDialog(props),
    {
      modules: {
        "@/components/ui/dialog": Object.fromEntries(
          ["Dialog", "DialogContent", "DialogHeader", "DialogTitle", "DialogDescription"].map(
            (name) => [name, name],
          ),
        ),
        "@/components/auth/ClerkSafe": {
          useUser: () => ({ isLoaded: true, isSignedIn: true, user: { id: owner } }),
        },
        "@/lib/public-chat-share-policy.mjs": { publicShareSnapshot },
        "@/lib/auth-fetch": {
          fetchWithTimeoutAuthenticated: (_url, options) => {
            const pending = deferred();
            requests.push({ ...pending, options });
            return pending.promise;
          },
        },
      },
      globals: {
        AbortController,
        navigator: {
          clipboard: {
            writeText: async (value) => {
              copies.push(value);
            },
          },
        },
        window: { location: { origin: "https://kovagpt.com" } },
      },
    },
  );
  const start = () =>
    f.find("button", (n) => n.props.className === "kova-share-copy").props.onClick();
  return {
    ...f,
    props,
    requests,
    copies,
    start,
    owner: (value) => {
      owner = value;
    },
  };
}
const response = (digit) =>
  new Response(
    JSON.stringify({ id: digit, path: `/share/${digit.repeat(64)}`, expiresAt: "2026-12-01" }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

for (const boundary of ["reopen", "account", "conversation"]) {
  test(`public Share ignores old responses after ${boundary} leaves and returns to the same identity`, async () => {
    const f = fixture();
    await f.flush();
    f.start();
    await f.flush();
    if (boundary === "reopen") f.props.open = false;
    if (boundary === "account") f.owner("owner-b");
    if (boundary === "conversation") f.props.conversation = { ...f.props.conversation, id: "b" };
    await f.flush();
    f.props.open = true;
    f.owner("owner-a");
    f.props.conversation = { ...f.props.conversation, id: "a" };
    await f.flush();
    f.start();
    await f.flush();
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[0].options.signal.aborted, true);
    f.requests[0].resolve(response("a"));
    await f.flush();
    assert.deepEqual(f.copies, []);
    assert.equal(
      f.find("button", (n) => n.props.className === "kova-share-copy").props.disabled,
      true,
      "stale completion cannot clear a newer request's pending state",
    );
    f.requests[1].resolve(response("b"));
    await f.flush();
    assert.deepEqual(f.copies, [`https://kovagpt.com/share/${"b".repeat(64)}`]);
    assert.equal(f.messages.filter(([type]) => type === "success").length, 1);
  });
}
