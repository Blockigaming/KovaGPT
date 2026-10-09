import test from "node:test";
import assert from "node:assert/strict";
import { createHookHarness, elements, loadUiModule, text } from "../helpers/ui-state-harness.mjs";

function fixture(fetchImpl) {
  const hooks = createHookHarness(),
    calls = [],
    updates = [];
  const { ToolConfirmCard } = loadUiModule("src/components/ToolConfirmCard.tsx", {
    react: hooks.react,
    "lucide-react": new Proxy({}, { get: (_, name) => String(name) }),
    sonner: { toast: { success() {}, error() {}, warning() {} } },
    "@/lib/auth-fetch": {
      async authFetch(url, options) {
        calls.push({ url, options });
        return fetchImpl(url, options);
      },
    },
  });
  const confirm = {
    actionId: "11111111-1111-4111-8111-111111111111",
    tool: "github.proposePatch",
    status: "pending",
    summary: "Prepare reviewed patch",
    argsPreview: {
      github_account: "owner-gh",
      repository: "acme/repo",
      operation: "proposePatch",
      details: {
        branch: "review-only",
        parentSha: "a".repeat(40),
        files: [{ path: "src/example.ts", content: "full code\n".repeat(100) + "FINAL CONTENT" }],
      },
    },
  };
  const tree = hooks.render(ToolConfirmCard, { confirm, onUpdate: (value) => updates.push(value) });
  const click = async (decision) =>
    elements(tree, (e) => e.type === "button" && text(e).trim() === decision)[0].props.onClick();
  return { calls, updates, tree, confirm, click };
}
for (const decision of ["Confirm", "Cancel"])
  test(`GitHub card displays the entire operation and ${decision} sends only its stored action ID`, async () => {
    const f = fixture(async () => ({
      ok: true,
      json: async () => ({ ok: true, result_text: "Done" }),
    }));
    const visible = text(f.tree);
    for (const value of [
      "owner-gh",
      "acme/repo",
      "review-only",
      "a".repeat(40),
      "src/example.ts",
      "FINAL CONTENT",
    ])
      assert.ok(visible.includes(value), value);
    assert.equal(f.calls.length, 0);
    await f.click(decision);
    assert.equal(f.calls[0].url, "/api/github/tool");
    assert.deepEqual(JSON.parse(f.calls[0].options.body), {
      action_id: f.confirm.actionId,
      decision: decision.toLowerCase(),
    });
    assert.equal(f.updates.at(-1).status, decision === "Confirm" ? "confirmed" : "cancelled");
  });

test("a lost GitHub mutation response checks status without resending the mutation", async () => {
  const f = fixture(async (_url, options) => {
    if (options?.method === "POST") throw new Error("lost reply");
    return { ok: true, json: async () => ({ ok: true, status: "processing" }) };
  });
  await f.click("Confirm");
  assert.equal(f.calls.filter((call) => call.options?.method === "POST").length, 1);
  assert.ok(f.calls[1].url.startsWith("/api/github/tool?action_id="));
  assert.equal(f.updates.at(-1).status, "uncertain");
  assert.match(f.updates.at(-1).resultText, /Inspect the repository/);
});
