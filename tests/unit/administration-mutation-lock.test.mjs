import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { deferred } from "../helpers/ui-state-harness.mjs";
function load(path, env) {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let fn;
  function visit(n) {
    if (ts.isFunctionDeclaration(n) && n.name?.text === "submit") fn = n.getText(source);
    ts.forEachChild(n, visit);
  }
  visit(source);
  const code = ts.transpileModule(fn, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(env), code + ";return submit;")(...Object.values(env));
}
for (const [family, path] of [
  ["Sites", "src/components/SitesPage.tsx"],
  ["Organizations", "src/components/OrganizationAdminPage.tsx"],
]) {
  function fixture() {
    const requests = [],
      notices = [];
    const epoch = { current: 1 };
    const env = {
      busy: false,
      mutationPending: { current: false },
      epoch,
      readEpoch: epoch,
      userId: "actor",
      controller: { current: new AbortController() },
      setBusy() {},
      setError() {},
      setNotice: (value) => notices.push(value),
      setRetry() {},
      setEmail() {},
      setDomain() {},
      refresh: async () => notices.push("refresh"),
      siteError: String,
      organizationErrorMessage: String,
      SiteRequestError: Error,
      OrganizationRequestError: Error,
    };
    const request = () => {
      const pending = deferred();
      requests.push(pending);
      return pending.promise;
    };
    env.siteRequest = request;
    env.organizationRequest = request;
    return { requests, notices, epoch, submit: load(path, env) };
  }
  test(`${family}: same-tick repeated mutation dispatches one request`, async () => {
    const f = fixture();
    const a = f.submit({ action: "create", siteId: "site", organizationId: "org" });
    const b = f.submit({ action: "create", siteId: "site", organizationId: "org" });
    const count = f.requests.length;
    for (const r of f.requests) r.resolve({ result: { siteId: "site" } });
    await Promise.all([a, b]);
    assert.equal(count, 1);
  });
  test(`${family}: completion after collection selection changes cannot replace the newer selection`, async () => {
    const f = fixture();
    const pending = f.submit({ action: "create", siteId: "site", organizationId: "org" });
    f.epoch.current++;
    f.requests[0].resolve({ result: { siteId: "site" } });
    await pending;
    assert.deepEqual(f.notices, [null]);
  });
}
