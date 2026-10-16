import { createHash } from "node:crypto";
import { supportRetryIdentity } from "../../src/lib/support-retry-identity.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import {
  createHookHarness,
  jsxRuntime,
  elements,
  text,
  deferred,
  settle,
} from "../helpers/ui-state-harness.mjs";
const source = ts.createSourceFile(
  "help.tsx",
  readFileSync("src/routes/help.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const node = source.statements.find(
  (n) => ts.isFunctionDeclaration(n) && n.name?.text === "SupportForm",
);
const compiled = ts.transpileModule(node.getText(source), {
  fileName: "form.tsx",
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
function fixture() {
  const hooks = createHookHarness();
  const requests = [];
  const stored = new Map();
  const storage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  };
  let actor = {
    id: "actor-a",
    fullName: "A",
    primaryEmailAddress: { emailAddress: "a@example.com" },
  };
  const dependencies = {
    exports: {},
    ...hooks.react,
    useUser: () => ({ user: actor }),
    fetchWithTimeout: (_url, options) => {
      const pending = deferred();
      requests.push({ body: JSON.parse(options.body), ...pending });
      return pending.promise;
    },
    crypto,
    supportRetryIdentity: (storage, actor, body, active, _crypto, intentionalNewRequest) =>
      supportRetryIdentity(
        storage,
        actor,
        body,
        active,
        {
          randomUUID: () => crypto.randomUUID(),
          subtle: {
            digest: async (_algorithm, bytes) =>
              Uint8Array.from(createHash("sha256").update(bytes).digest()).buffer,
          },
        },
        intentionalNewRequest,
      ),
    safeBrowserStorage: () => storage,
    require: () => jsxRuntime,
    TOPICS: [],
    CheckCircle2: "check",
    Button: "button",
    Label: "label",
    Input: "input",
    Textarea: "textarea",
    Loader2: "loader",
  };
  const component = new Function(...Object.keys(dependencies), `${compiled};return SupportForm;`)(
    ...Object.values(dependencies),
  );
  let tree;
  const render = () => {
    tree = hooks.render(component);
    return tree;
  };
  render();
  render();
  const input = (id, value) => {
    elements(tree, (e) => e.props.id === id)[0].props.onChange({ target: { value } });
    render();
  };
  input("support-message", "Please help");
  return {
    requests,
    render,
    input,
    get tree() {
      return tree;
    },
    submit: () =>
      elements(tree, (e) => e.type === "form")[0].props.onSubmit({ preventDefault() {} }),
    actor(next) {
      actor = next;
      render();
      render();
    },
    unmount: () => hooks.unmount(),
  };
}
test("same-tick support submit sends once; malformed HTTP success is not acceptance; retry keeps identity", async () => {
  const f = fixture();
  const first = f.submit();
  await f.submit();
  await settle();
  assert.equal(f.requests.length, 1);
  f.requests[0].resolve(Response.json({ success: true }));
  await first;
  f.render();
  assert.match(text(f.tree), /could not be confirmed/);
  assert.doesNotMatch(text(f.tree), /Request queued/);
  const retry = f.submit();
  assert.equal(f.requests[1].body.requestId, f.requests[0].body.requestId);
  assert.equal(f.requests[1].body.url, "");
  assert.equal(f.requests[1].body.userAgent, "");
  f.requests[1].resolve(
    Response.json({ success: true, status: "queued", reference: f.requests[1].body.requestId }),
  );
  await retry;
  f.render();
  assert.match(text(f.tree), /Request queued/);
  assert.match(text(f.tree), /Delivery is not yet confirmed/);
});
test("account changes clear support drafts and ignore previous actor acceptance", async () => {
  const f = fixture();
  const pending = f.submit();
  await settle();
  f.actor({ id: "actor-b", primaryEmailAddress: { emailAddress: "b@example.com" } });
  assert.equal(elements(f.tree, (e) => e.props.id === "support-message")[0].props.value, "");
  f.requests[0].resolve(
    Response.json({ success: true, status: "queued", reference: f.requests[0].body.requestId }),
  );
  await pending;
  f.render();
  assert.doesNotMatch(text(f.tree), /Request queued|a@example.com/);
});

test("confirmed receipt then explicit new identical message rotates identity; unknown retries retain it", async () => {
  const f = fixture();
  const first = f.submit();
  await settle();
  const oldId = f.requests[0].body.requestId;
  f.requests[0].resolve(Response.json({ success: true, status: "queued", reference: oldId }));
  await first;
  f.render();
  elements(
    f.tree,
    (e) => e.type === "button" && text(e) === "Send another message",
  )[0].props.onClick();
  f.render();
  f.input("support-message", "Please help");
  const next = f.submit();
  await settle();
  const newId = f.requests[1].body.requestId;
  assert.notEqual(newId, oldId);
  f.requests[1].resolve(Response.json({ success: true }));
  await next;
  f.render();
  assert.equal(elements(f.tree, (e) => text(e) === "Send another message").length, 0);
  const retry = f.submit();
  await settle();
  assert.equal(f.requests[2].body.requestId, newId);
  f.requests[2].resolve(Response.json({ success: true, status: "queued", reference: newId }));
  await retry;
});
