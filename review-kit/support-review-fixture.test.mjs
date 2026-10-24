import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { z } from "zod";
import {
  createSupportReviewHandler,
  validSupportReviewBody,
  SUPPORT_REVIEW_SCENARIOS,
  SUPPORT_REVIEW_OPTIONS,
  SUPPORT_REVIEW_DISCLOSURE,
  SUPPORT_REVIEW_MAX_BODY_BYTES,
  SUPPORT_REVIEW_SAMPLE_BODY as sample,
} from "./support-review-fixture.mjs";
import {
  createHookHarness,
  loadUiModule,
  elements,
  text,
  deferred,
  settle,
} from "../tests/helpers/ui-state-harness.mjs";

// Mock routes and the real source component in its existing hook harness only.
// No browser, HTTP listener, full build, support provider or production import.
const origin = "http://127.0.0.1:4189";
const path = "/api/public/help-submit";
function fixture(scenario, options = {}) {
  const state = { active: true };
  const waits = [];
  const hold = deferred();
  const handler = createSupportReviewHandler(scenario, {
    isActive: () => state.active,
    wait: (signal) => {
      waits.push(signal);
      return hold.promise;
    },
    ...options,
  });
  async function invoke(body = sample, options = {}) {
    let response;
    await handler({
      request: () => ({
        url: () => options.url ?? origin + path,
        method: () => options.method ?? "POST",
        headers: () => options.headers ?? { "content-type": "application/json" },
        postData: () => (Object.hasOwn(options, "raw") ? options.raw : JSON.stringify(body)),
        signal: () => options.signal,
      }),
      fulfill: async (value) => {
        response = value;
      },
      fallback: async () => {
        response = { fallback: true };
      },
    });
    return response;
  }
  return { state, waits, hold, handler, invoke };
}

test("four explicit scenarios cover the public Guest and signed-in form, with synthetic acceptance disclosure", () => {
  assert.deepEqual(SUPPORT_REVIEW_SCENARIOS, [
    "support-pending",
    "support-rejected",
    "support-uncertain",
    "support-accepted",
  ]);
  assert.deepEqual(
    SUPPORT_REVIEW_OPTIONS.map(({ id }) => id),
    SUPPORT_REVIEW_SCENARIOS,
  );
  for (const option of SUPPORT_REVIEW_OPTIONS) {
    assert.deepEqual(option.accounts, ["guest", "free", "plus", "pro"]);
    assert.equal(option.path, "/help");
    assert.match(option.label, /synthetic.*no email/);
    assert.ok(Object.isFrozen(option) && Object.isFrozen(option.accounts));
  }
  assert.match(SUPPORT_REVIEW_DISCLOSURE, /Accepted is a simulation only/);
  assert.match(SUPPORT_REVIEW_DISCLOSURE, /No email.*queue or backend is contacted/);
  assert.match(SUPPORT_REVIEW_DISCLOSURE, /no submitted fields are stored or logged/);
  assert.match(SUPPORT_REVIEW_DISCLOSURE, /own 20-second timeout may win/);
  assert.throws(() => createSupportReviewHandler("unknown", { isActive: () => true }), /Unknown/);
  assert.throws(() => createSupportReviewHandler("support-accepted"), /active session/);
  assert.throws(
    () => createSupportReviewHandler("support-pending", { isActive: () => true }),
    /bounded/,
  );
});

test("sample payload and field limits agree with the actual server BodySchema", () => {
  const source = readFileSync(
    new URL("../src/routes/api/public/help-submit.ts", import.meta.url),
    "utf8",
  );
  const schema = source.match(/const BodySchema = (z\.object\(\{[\s\S]*?\}\));/);
  assert.ok(schema, "Read the actual source BodySchema without executing the support route");
  const BodySchema = vm.runInNewContext(schema[1], { z });
  assert.equal(BodySchema.safeParse(sample).success, true);
  assert.equal(validSupportReviewBody(sample), true);
  assert.equal(SUPPORT_REVIEW_MAX_BODY_BYTES, 32 * 1024);
  assert.match(source, /const MAX_BODY_BYTES = 32 \* 1024/);
  const variants = [
    { email: sample.email, message: "Minimum allowed payload" },
    {
      ...sample,
      name: "x".repeat(120),
      topic: "x".repeat(200),
      message: "x".repeat(4000),
      url: "x".repeat(500),
      userAgent: "x".repeat(500),
    },
    { ...sample, email: "  Sample+test@Example.INVALID  ", message: " trim surrounding spaces " },
    ...["name", "topic", "message", "url", "userAgent"].map((key) => ({
      ...sample,
      [key]: "x".repeat(
        { name: 120, topic: 200, message: 4000, url: 500, userAgent: 500 }[key] + 1,
      ),
    })),
    ...[
      "",
      ".sample@example.invalid",
      "two..dots@example.invalid",
      "sample@.invalid",
      "invalid",
    ].map((email) => ({ ...sample, email })),
    { ...sample, message: "  " },
    { ...sample, website: "bot-filled" },
  ];
  for (const value of variants)
    assert.equal(
      validSupportReviewBody(value),
      BodySchema.safeParse(value).success,
      JSON.stringify(value).slice(0, 100),
    );
  for (const value of [
    { ...sample, email: "real@example.com" },
    { ...sample, variant: "bug" },
    { ...sample, operation: "send" },
  ]) {
    assert.equal(BodySchema.safeParse(value).success, true);
    assert.equal(validSupportReviewBody(value), false, "Deliberately narrower than production");
  }
});

test("accepted, rejected and uncertain use exact classifier DTOs without echoing contact or content", async () => {
  for (const [scenario, status] of [
    ["support-accepted", 200],
    ["support-rejected", 400],
    ["support-uncertain", 503],
  ]) {
    const f = fixture(scenario);
    const response = await f.invoke({
      ...sample,
      name: "Fictional secret marker",
      message: "Disposable message marker",
    });
    assert.equal(response.status, status);
    assert.equal(response.headers["Cache-Control"], "no-store");
    assert.equal(response.headers["X-Kova-Review-Only"], "synthetic-no-delivery");
    if (status === 200) assert.deepEqual(response.json, { success: true });
    else {
      assert.deepEqual(Object.keys(response.json), ["error"]);
      assert.match(response.json.error, /Synthetic Support/);
    }
    assert.doesNotMatch(JSON.stringify(response), /review@example|secret marker|message marker/);
    assert.deepEqual(f.waits, []);
    assert.deepEqual(
      Object.keys(f.handler),
      [],
      "No request history or submitted fields are exposed",
    );
  }
});

test("unknown operations, malformed fields, real addresses and non-form requests fail closed", async () => {
  const f = fixture("support-accepted");
  for (const body of [
    null,
    [],
    {},
    { ...sample, email: null },
    { ...sample, email: "real@example.com" },
    { ...sample, operation: "send" },
    { ...sample, recipient: "real@example.com" },
    { ...sample, attachments: [] },
    { ...sample, name: {} },
    { ...sample, variant: "bug" },
    { ...sample, website: "bot" },
    { ...sample, message: "x".repeat(4001) },
    { ...sample, email: "x".repeat(240) + "@example.invalid" },
  ])
    assert.equal((await f.invoke(body)).status, 400);
  for (const raw of [
    null,
    "",
    "not JSON",
    '{"operation":"send"}',
    '{"__proto__":{},"email":"review@example.invalid","message":"sample"}',
  ])
    assert.equal((await f.invoke(null, { raw })).status, 400);
  for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    const response = await f.invoke(sample, { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.Allow, "POST");
  }
  for (const headers of [
    {},
    { "content-type": "text/plain" },
    { "content-type": "application/json", authorization: "unexpected" },
    { "content-type": "application/json", "x-kova-owner": "other" },
  ])
    assert.ok([400, 415].includes((await f.invoke(sample, { headers })).status));
  assert.equal(
    (await f.invoke(sample, { headers: { "Content-Type": "application/json; charset=utf-8" } }))
      .status,
    200,
  );
  assert.equal((await f.invoke(sample, { url: origin + path + "?operation=send" })).status, 400);
  assert.equal((await f.invoke(sample, { url: "https://outside.invalid" + path })).status, 403);
  assert.deepEqual(await f.invoke(sample, { url: origin + "/api/unrelated" }), { fallback: true });
  assert.equal(
    (await f.invoke(sample, { raw: " ".repeat(SUPPORT_REVIEW_MAX_BODY_BYTES + 1) })).status,
    413,
  );
  assert.equal(
    (await f.invoke(sample, { raw: "é".repeat(SUPPORT_REVIEW_MAX_BODY_BYTES / 2 + 1) })).status,
    413,
  );
  assert.equal(
    (
      await f.invoke(sample, {
        headers: {
          "content-type": "application/json",
          "content-length": String(SUPPORT_REVIEW_MAX_BODY_BYTES + 1),
        },
      })
    ).status,
    413,
  );
});

test("public active session is the only account gate; disposed and malformed activity cannot simulate acceptance", async () => {
  const f = fixture("support-accepted");
  assert.equal(
    (await f.invoke()).status,
    200,
    "No auth or owner header needed for guest/public form",
  );
  assert.equal(
    (
      await f.invoke(sample, {
        headers: { "content-type": "application/json", cookie: "synthetic-session=present" },
      })
    ).status,
    200,
  );
  f.state.active = false;
  assert.equal((await f.invoke()).status, 409);
  assert.equal(
    (await fixture("support-accepted", { isActive: () => "truthy" }).invoke()).status,
    409,
  );
  assert.equal(
    (await fixture("support-accepted").invoke()).status,
    200,
    "Fresh session is independent",
  );
});

test("pending passes the request signal to the parent's bounded wait and can never auto-accept", async () => {
  for (const reason of ["expired", "capacity", "released", "unexpected"]) {
    const f = fixture("support-pending");
    const controller = new AbortController();
    let settled = false;
    const pending = f.invoke(sample, { signal: controller.signal }).then((value) => {
      settled = true;
      return value;
    });
    await settle();
    assert.equal(settled, false);
    assert.deepEqual(f.waits, [controller.signal]);
    f.hold.resolve(reason);
    const response = await pending;
    assert.equal(response.status, 503);
    assert.match(response.json.error, /Nothing was sent/);
    assert.equal(response.json.success, undefined);
  }
  const thrown = fixture("support-pending", {
    wait: async () => {
      throw new Error("private failure details");
    },
  });
  const response = await thrown.invoke();
  assert.equal(response.status, 503);
  assert.doesNotMatch(response.json.error, /private failure details/);
});

test("reset, sign-out and abort invalidate held requests, including a stale expired completion", async () => {
  for (const reason of ["aborted", "reset", "disposed"]) {
    const f = fixture("support-pending");
    const pending = f.invoke();
    f.hold.resolve(reason);
    assert.equal((await pending).status, 499);
  }
  const f = fixture("support-pending");
  const pending = f.invoke();
  f.state.active = false;
  f.hold.resolve("expired");
  assert.equal((await pending).status, 499);
  const g = fixture("support-pending");
  const controller = new AbortController();
  const aborted = g.invoke(sample, { signal: controller.signal });
  controller.abort();
  g.hold.resolve("expired");
  assert.equal((await aborted).status, 499);
  const h = fixture("support-pending");
  assert.equal((await h.invoke(sample, { signal: controller.signal })).status, 499);
  assert.deepEqual(h.waits, []);
  assert.equal((await h.invoke({ ...sample, email: "real@example.com" })).status, 400);
  assert.deepEqual(h.waits, [], "Invalid requests never enter a hold");
});

function formFixture(scenario, guest = false) {
  const transport = fixture(scenario);
  const h = createHookHarness();
  let user = guest
    ? null
    : {
        id: "synthetic-owner-a",
        fullName: sample.name,
        primaryEmailAddress: { emailAddress: sample.email },
      };
  const requests = [];
  const frames = [];
  const document = { body: {}, activeElement: {}, getElementById: () => ({ focus() {} }) };
  const { HelpSupportForm } = loadUiModule(
    "src/components/HelpSupportForm.tsx",
    {
      react: h.react,
      "lucide-react": { CheckCircle2: "CheckCircle2", Loader2: "Loader2" },
      "@/components/auth/ClerkSafe": { useUser: () => ({ user }) },
      "@/components/ui/button": { Button: "Button" },
      "@/components/ui/input": { Input: "Input" },
      "@/components/ui/label": { Label: "Label" },
      "@/components/ui/textarea": { Textarea: "Textarea" },
      "@/components/ui/searchable-picker": { SearchablePicker: "SearchablePicker" },
      "@/lib/fetch-with-timeout": {
        fetchWithTimeout: async (url, init, timeout) => {
          requests.push({ url, init, timeout });
          const response = await transport.invoke(null, {
            url: origin + url,
            method: init.method,
            headers: init.headers,
            raw: init.body,
          });
          return {
            status: response.status,
            ok: response.status >= 200 && response.status < 300,
            json: async () => response.json,
          };
        },
      },
    },
    {
      document,
      window: { location: { href: origin + "/help" } },
      navigator: { userAgent: sample.userAgent },
      requestAnimationFrame: (fn) => frames.push(fn),
    },
  );
  let tree;
  const render = () => {
    tree = h.render(HelpSupportForm);
    return tree;
  };
  const change = (id, value) => {
    elements(tree, (node) => node.props.id === id)[0].props.onChange({ target: { value } });
    render();
  };
  render();
  render();
  if (guest) change("support-email", sample.email);
  change("support-message", sample.message);
  return {
    transport,
    requests,
    frames,
    render,
    change,
    submit: () =>
      elements(tree, (node) => node.type === "form")[0].props.onSubmit({ preventDefault() {} }),
    get tree() {
      return tree;
    },
    changeOwner() {
      user = null;
      render();
      render();
    },
    unmount: h.unmount,
  };
}

test("actual HelpSupportForm uses the fixtures for guest and signed-in acceptance, rejection and uncertainty", async () => {
  for (const guest of [true, false]) {
    const accepted = formFixture("support-accepted", guest);
    await accepted.submit();
    accepted.render();
    assert.match(text(accepted.tree), /Request accepted/);
    assert.equal(accepted.requests[0].url, path);
    assert.equal(accepted.requests[0].timeout, 20_000);
    assert.deepEqual(
      Object.keys(JSON.parse(accepted.requests[0].init.body)).sort(),
      Object.keys(sample).sort(),
    );
    assert.deepEqual(Object.keys(accepted.requests[0].init.headers), ["Content-Type"]);
    const another = elements(accepted.tree, (node) => node.type === "Button")[0];
    another.props.onClick({ currentTarget: {} });
    accepted.render();
    assert.equal(
      elements(accepted.tree, (node) => node.props.id === "support-message")[0].props.value,
      "",
    );
    const rejected = formFixture("support-rejected", guest);
    await rejected.submit();
    rejected.render();
    assert.match(text(rejected.tree), /Support did not accept this request/);
    assert.equal(
      elements(rejected.tree, (node) => node.props.id === "support-message")[0].props.value,
      sample.message,
    );
    await rejected.submit();
    assert.equal(rejected.requests.length, 2, "Only explicit retry after a known rejection");
    const uncertain = formFixture("support-uncertain", guest);
    await uncertain.submit();
    uncertain.render();
    assert.match(text(uncertain.tree), /couldn’t confirm whether support accepted/);
    assert.match(text(uncertain.tree), /There is no automatic retry/);
    assert.equal(
      elements(uncertain.tree, (node) => node.props.type === "submit")[0].props.disabled,
      true,
    );
    assert.equal(
      elements(uncertain.tree, (node) => node.props.id === "support-message")[0].props.value,
      sample.message,
    );
    await uncertain.submit();
    assert.equal(uncertain.requests.length, 1);
  }
});

test("actual form's pending/duplicate/stale owner/unmount behavior remains intact", async () => {
  const f = formFixture("support-pending");
  const pending = f.submit();
  f.render();
  assert.match(text(f.tree), /Sending/);
  assert.equal(elements(f.tree, (node) => node.props.type === "submit")[0].props.disabled, true);
  await f.submit();
  assert.equal(f.requests.length, 1);
  f.transport.hold.resolve("expired");
  await pending;
  f.render();
  assert.match(text(f.tree), /couldn’t confirm/);
  for (const stop of ["changeOwner", "unmount"]) {
    const stale = formFixture("support-pending");
    const request = stale.submit();
    stale[stop]();
    stale.transport.hold.resolve("expired");
    await request;
    if (stop === "changeOwner") {
      stale.render();
      assert.doesNotMatch(text(stale.tree), /couldn’t confirm|Request accepted/);
      assert.equal(
        elements(stale.tree, (node) => node.props.id === "support-message")[0].props.value,
        "",
      );
    }
    assert.equal(stale.frames.length, 0);
  }
});

test("fixture has no production imports, provider calls, writes, request logs or response contact echo", () => {
  const source = readFileSync(new URL("./support-review-fixture.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import\s/m);
  assert.doesNotMatch(
    source,
    /\b(?:fetch|createClient|enqueueFixedRecipient|writeFileSync|writeFile)\s*\(|console\./,
  );
  assert.doesNotMatch(source, /requests\.push|JSON\.stringify\(body\)|reply\(body\)/);
});
