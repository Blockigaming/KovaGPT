import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";

function recoveryFixture(request = async () => ({ ok: true })) {
  let open = true;
  const changes = [];
  const f = reactFixture(
    "src/components/auth/ForgotPasswordDialog.tsx",
    (exports) => () =>
      exports.ForgotPasswordDialog({
        open,
        onOpenChange(value) {
          open = value;
          changes.push(value);
        },
      }),
    {
      modules: {
        "@/components/NovaLogo": { NovaLogo: "NovaLogo" },
        "@/components/ui/dialog": {
          Dialog: "dialog",
          DialogContent: "dialog-content",
          DialogHeader: "header",
          DialogTitle: "h2",
          DialogDescription: "p",
        },
        "@/integrations/supabase/client": { supabase: {} },
        "@/lib/kova-auth-browser": {
          browserKovaAuthEnabled: () => true,
          kovaPublicAuthJson: request,
        },
      },
      globals: { window: { requestAnimationFrame: (run) => run() }, console },
    },
  );
  return {
    ...f,
    changes,
    reopen() {
      open = true;
      return f.flush();
    },
  };
}

test("recovery Done clears the sent screen and email before reopening", async () => {
  const f = recoveryFixture();
  await f.flush();
  await f.input("fp-email", "person@example.test");
  await f.submit();
  await f.flush();
  assert.match(f.text(), /person@example.test/);
  await f.click("Done");
  assert.deepEqual(f.changes, [false]);
  await f.reopen();
  assert.equal(f.find("input").props.value, "");
  assert.doesNotMatch(f.text(), /Use a different email/);
});

test("recovery Cancel invalidates pending requests and ignores their late result", async () => {
  let resolve;
  let requests = 0;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const f = recoveryFixture(() => {
    requests += 1;
    return pending;
  });
  await f.flush();
  await f.input("fp-email", "person@example.test");
  const first = f.submit();
  await f.submit();
  assert.equal(requests, 1);
  await f.click("Cancel");
  await f.reopen();
  resolve({ ok: true });
  await first;
  await f.flush();
  assert.equal(f.find("input").props.value, "");
  assert.doesNotMatch(f.text(), /Use a different email/);
  assert.equal(f.messages.length, 0);
});

test("recovery use a different email clears the previous request state", async () => {
  const f = recoveryFixture();
  await f.flush();
  await f.input("fp-email", "person@example.test");
  await f.submit();
  await f.flush();
  await f.click("Use a different email");
  assert.equal(f.find("input").props.value, "");
  assert.equal(f.find("button", (node) => node.props.type === "submit").props.disabled, false);
});

test("recovery layout protections remain local to their surfaces", () => {
  const read = (path) => readFileSync(`src/${path}`, "utf8");
  assert.match(
    read("components/OnboardingDialog.tsx"),
    /onCloseAutoFocus[\s\S]*Message KovaGPT[\s\S]*preventScroll: true/,
  );
  assert.match(
    read("components/MemorySourcesDialog.tsx"),
    /flex flex-wrap items-center justify-between/,
  );
  assert.match(read("components/public/LegalDoc.tsx"), /listStyle: "none"/);
  assert.match(
    read("routes/checkout.return.tsx"),
    /flex w-full min-w-0 max-w-md flex-col items-center/,
  );
});
