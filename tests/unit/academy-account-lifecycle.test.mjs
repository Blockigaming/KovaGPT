import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { loadUiModule, createHookHarness, settle, deferred } from "../helpers/ui-state-harness.mjs";
import * as policy from "../../src/lib/academy-state-policy.mjs";
import { EMPTY_ACADEMY_PROGRESS } from "../../src/lib/academy-progress.mjs";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
function fixture(enabled = true) {
  const h = createHookHarness(),
    loads = [],
    saves = [];
  let actor = A;
  const get = () => {
      const d = deferred();
      loads.push(d);
      return d.promise;
    },
    save = (request) => {
      const d = deferred();
      saves.push({ ...d, request });
      return d.promise;
    };
  let draft = {
    loaded: true,
    stored: false,
    allowAutomaticAccountHydration: true,
    dirty: false,
    epoch: 1,
    value: EMPTY_ACADEMY_PROGRESS,
    setValue: (value) => {
      draft = { ...draft, value, dirty: true };
    },
  };
  const { useAcademyAccount } = loadUiModule(
    "src/lib/use-academy-account.ts",
    {
      react: h.react,
      "@tanstack/react-start": { useServerFn: (fn) => fn },
      "./academy-state.functions": { getAcademyState: get, saveAcademyState: save },
      "./academy-state-policy.mjs": { ...policy, ACADEMY_ACCOUNT_PERSISTENCE_ENABLED: enabled },
      "./academy-progress.mjs": { EMPTY_ACADEMY_PROGRESS },
    },
    { crypto: webcrypto },
  );
  const render = () => h.render(() => useAcademyAccount(actor, "writing", draft));
  return {
    h,
    render,
    loads,
    saves,
    setActor: (v) => (actor = v),
    setDraft: (v) => (draft = { ...draft, ...v }),
    get draft() {
      return draft;
    },
  };
}
const record = (body, owner = A, revision = 1) => ({
  owner_id: owner,
  topic: "writing",
  body,
  revision,
  updated_at: "2026-10-12T00:00:00Z",
});
test("paused launch never loads or saves Academy account state and preserves the device draft", async () => {
  assert.equal(policy.ACADEMY_ACCOUNT_PERSISTENCE_ENABLED, false);
  const f = fixture(policy.ACADEMY_ACCOUNT_PERSISTENCE_ENABLED);
  const value = { ...EMPTY_ACADEMY_PROGRESS, notes: "existing device draft" };
  f.setDraft({ value, stored: true });
  const account = f.render();
  await account.saveCurrent();
  account.refresh();
  account.useAccount();
  f.render();
  await settle();
  assert.equal(f.loads.length, 0);
  assert.equal(f.saves.length, 0);
  assert.deepEqual(f.draft.value, value);
});
test("late account loads cannot expose prior notes; recovered/newly typed device draft is never silently replaced", async () => {
  const f = fixture();
  f.render();
  f.setActor(B);
  assert.equal(f.render().record, null);
  f.loads[0].resolve(record({ ...EMPTY_ACADEMY_PROGRESS, notes: "A secret" }));
  await settle();
  assert.equal(f.render().record, null);
  f.setDraft({ stored: true, value: { ...EMPTY_ACADEMY_PROGRESS, notes: "B recovered" } });
  f.render();
  f.loads[1].resolve(record({ ...EMPTY_ACADEMY_PROGRESS, notes: "B server" }, B));
  await settle();
  assert.equal(f.draft.value.notes, "B recovered");
  assert.equal(f.render().record.body.notes, "B server");
});
test("failed account save retains draft and retry identity; successful old save does not overwrite newer typing", async () => {
  const f = fixture();
  f.render();
  f.loads[0].resolve(null);
  await settle();
  f.setDraft({ value: { ...EMPTY_ACADEMY_PROGRESS, notes: "first" }, dirty: true });
  const one = f.render().saveCurrent();
  f.saves[0].reject(Error("offline"));
  await one;
  assert.equal(f.draft.value.notes, "first");
  const retry = f.render().saveCurrent();
  assert.equal(f.saves[1].request.data.mutationId, f.saves[0].request.data.mutationId);
  f.setDraft({ value: { ...EMPTY_ACADEMY_PROGRESS, notes: "newer" } });
  f.saves[1].resolve(record(f.saves[1].request.data.body));
  await retry;
  assert.equal(f.draft.value.notes, "newer");
  assert.equal(f.render().matches, false);
});
test("account switch and local recovery clear fence pending account save acknowledgements", async () => {
  for (const change of ["account", "clear"]) {
    const f = fixture();
    f.render();
    f.loads[0].resolve(null);
    await settle();
    f.setDraft({ value: { ...EMPTY_ACADEMY_PROGRESS, notes: "A old" }, dirty: true });
    const pending = f.render().saveCurrent();
    if (change === "account") f.setActor(B);
    else f.setDraft({ epoch: 2, value: EMPTY_ACADEMY_PROGRESS, dirty: false });
    f.render();
    f.saves[0].resolve(record(f.saves[0].request.data.body));
    await pending;
    assert.equal(f.render().record, null);
    assert.equal(f.render().pending, false);
  }
});

test("clearing local recovery cannot silently rehydrate account notes into the device", async () => {
  const f = fixture();
  f.render();
  f.loads[0].resolve(record({ ...EMPTY_ACADEMY_PROGRESS, notes: "account notes" }));
  await settle();
  f.render();
  f.setDraft({ epoch: 2, value: EMPTY_ACADEMY_PROGRESS, stored: false, dirty: false });
  f.render();
  f.loads[1].resolve(record({ ...EMPTY_ACADEMY_PROGRESS, notes: "account notes" }));
  await settle();
  assert.equal(f.draft.value.notes, "");
  assert.equal(f.render().record.body.notes, "account notes");
  f.render().useAccount();
  assert.equal(f.draft.value.notes, "account notes");
});
