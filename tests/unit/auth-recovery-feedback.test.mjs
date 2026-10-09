import assert from "node:assert/strict";
import test from "node:test";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";
function recovery(options = {}) {
  const requests = [];
  const props = { open: true, initialEmail: "owner@example.invalid", onOpenChange() {} };
  let failed = options.fail;
  const request = async (email) => {
    requests.push(email);
    if (options.hold) await options.hold;
    if (failed) throw new Error("private upstream detail");
  };
  const fixture = reactFixture(
    "src/components/auth/ForgotPasswordDialog.tsx",
    (exp) => () => exp.ForgotPasswordDialog(props),
    {
      modules: {
        "@/components/ui/dialog": {
          Dialog: "dialog",
          DialogContent: "dialog-content",
          DialogHeader: "header",
          DialogTitle: "title",
          DialogDescription: "description",
        },
        "@/lib/kova-auth-browser": {
          browserKovaAuthEnabled: () => options.owned !== false,
          kovaPublicAuthJson: async (_path, body) => {
            await request(body.email);
            return Response.json({ accepted: true });
          },
        },
        "@/integrations/supabase/client": {
          supabase: {
            auth: {
              resetPasswordForEmail: async (email) => {
                await request(email);
                return {};
              },
            },
          },
        },
      },
      globals: {
        window: { location: { origin: "https://kova.test" } },
        setTimeout: () => 1,
        clearTimeout() {},
        console: { error() {} },
      },
    },
  );
  return {
    ...fixture,
    requests,
    props,
    allowRetry: () => {
      failed = false;
    },
  };
}
test("recovery pre-fills identity, prevents duplicate requests, and never claims delivery", async () => {
  for (const owned of [true, false]) {
    let release;
    const hold = new Promise((resolve) => {
      release = resolve;
    });
    const view = recovery({ owned, hold });
    await view.flush();
    assert.equal(view.find("input").props.value, "owner@example.invalid");
    const first = view.submit(),
      second = view.submit();
    await view.flush();
    assert.deepEqual(view.requests, ["owner@example.invalid"]);
    assert.equal(view.find("input").props.disabled, true);
    release();
    await Promise.all([first, second]);
    await view.flush();
    assert.match(view.text(), /If this email has an account, a reset link has been requested/);
    assert.doesNotMatch(view.text(), /We sent|link sent|in a minute/);
    assert.deepEqual(view.messages, []);
    view.unmount();
  }
});
test("recovery failure keeps email and presents a safe retryable inline error", async () => {
  const view = recovery({ fail: true });
  await view.flush();
  await view.submit();
  await view.flush();
  assert.equal(view.find("input").props.value, "owner@example.invalid");
  assert.match(
    view.find("p", (node) => node.props.role === "alert").props.children,
    /Please try again/,
  );
  assert.doesNotMatch(view.text(), /private upstream detail/);
  view.allowRetry();
  await view.submit();
  await view.flush();
  assert.match(view.text(), /Check your email/);
  assert.equal(view.requests.length, 2);
  view.unmount();
});
test("a request finishing after the recovery dialog closes cannot change its next open state", async () => {
  let release;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const view = recovery({ hold });
  await view.flush();
  const pending = view.submit();
  view.props.open = false;
  await view.flush();
  view.props.open = true;
  view.props.initialEmail = "second@example.invalid";
  await view.flush();
  release();
  await pending;
  await view.flush();
  assert.equal(view.find("input").props.value, "second@example.invalid");
  assert.doesNotMatch(view.text(), /Check your email/);
  view.unmount();
});
