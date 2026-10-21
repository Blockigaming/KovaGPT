import assert from "node:assert/strict";
import test from "node:test";
import {
  createHookHarness,
  loadUiModule,
  text,
  elements,
  deferred,
  settle,
} from "../helpers/ui-state-harness.mjs";
function fixture(plan = { tier: "free", status: "ready" }) {
  const h = createHookHarness();
  const requests = [];
  const timers = [];
  const read = () => {
    const request = deferred();
    requests.push(request);
    return request.promise;
  };
  const { ComposerUploadAllowance } = loadUiModule(
    "src/components/ComposerUploadAllowance.tsx",
    {
      react: h.react,
      "@/hooks/useTier": { useTier: () => plan },
      "@tanstack/react-start": { useServerFn: () => read },
      "@/utils/usage.functions": { getMyDailyUsage: read },
      "@/lib/modes": { DAILY_UPLOAD_LIMIT_BY_TIER: { free: 2, plus: 50, pro: 200 } },
    },
    {
      Date,
      Intl,
      setTimeout: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearTimeout() {},
    },
  );
  let props = { ownerId: "a", tier: "free" };
  let tree;
  const render = (next = {}) => {
    props = { ...props, ...next };
    tree = h.render(ComposerUploadAllowance, props);
    return tree;
  };
  render();
  render();
  return {
    render,
    requests,
    timers,
    h,
    get tree() {
      return tree;
    },
  };
}
const data = (uploads = 1) => ({
  date: "2026-10-19",
  uploads,
  chats: 0,
  images: 0,
  resetsAt: new Date(Date.now() + 100_000).toISOString(),
});
test("loading never paints zero, then authoritative remaining and UTC reset appear", async () => {
  const f = fixture();
  assert.match(text(f.tree).replace(/\s+/g, " "), /Checking/);
  assert.doesNotMatch(text(f.tree).replace(/\s+/g, " "), /remaining today/);
  f.requests[0].resolve(data());
  await settle();
  f.render();
  assert.match(text(f.tree).replace(/\s+/g, " "), /1 of 2 uploads remaining today/);
  assert.match(text(f.tree).replace(/\s+/g, " "), /UTC/);
  f.timers[0].fn();
  f.render();
  f.render();
  assert.equal(f.requests.length, 2);
  assert.match(text(f.tree).replace(/\s+/g, " "), /Checking/);
});
test("failed or stale usage stays unavailable and offers Retry", async () => {
  const f = fixture();
  f.requests[0].reject(new Error("Offline"));
  await settle();
  f.render();
  assert.match(text(f.tree).replace(/\s+/g, " "), /unavailable/);
  elements(f.tree, (x) => x.type === "button")[0].props.onClick();
  f.render();
  assert.equal(f.requests.length, 2);
  f.requests[1].resolve({ ...data(), resetsAt: new Date(Date.now() - 1).toISOString() });
  await settle();
  f.render();
  assert.match(text(f.tree).replace(/\s+/g, " "), /unavailable/);
});
test("principal transition excludes old counts and guests issue no usage read", async () => {
  const f = fixture();
  f.render({ ownerId: "b" });
  f.requests[1].resolve(data(0));
  await settle();
  f.requests[0].resolve(data(2));
  await settle();
  f.render();
  assert.match(text(f.tree).replace(/\s+/g, " "), /2 of 2/);
  f.render({ ownerId: null });
  f.render();
  assert.match(text(f.tree).replace(/\s+/g, " "), /Sign in/);
  assert.equal(f.requests.length, 2);
});
test("limit reached is zero remaining without fabricated negative or percentage", async () => {
  const f = fixture();
  f.requests[0].resolve(data(3));
  await settle();
  f.render();
  assert.match(text(f.tree).replace(/\s+/g, " "), /0 of 2/);
  assert.doesNotMatch(text(f.tree).replace(/\s+/g, " "), /%/);
});

test("unknown plan never invents a Free denominator", async () => {
  const plan = { tier: "free", status: "loading" };
  const f = fixture(plan);
  f.requests[0].resolve(data());
  await settle();
  f.render();
  assert.match(text(f.tree), /Checking your plan/);
  plan.status = "unavailable";
  f.render();
  assert.match(text(f.tree), /plan limit is unavailable/);
  assert.doesNotMatch(text(f.tree), /of 2/);
});
