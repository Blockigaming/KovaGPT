import assert from "node:assert/strict";
import test from "node:test";
import { reactFixture, nodes } from "../helpers/kova-react-fixture.mjs";
import * as interactive from "../../src/lib/interactive-ui.mjs";

const nextSteps = interactive.validateInteractiveBlock({
  version: 1,
  type: "form",
  id: "next-steps",
  title: "Choose your next step",
  actions: [
    { id: "plan", label: "Build my launch plan", style: "primary" },
    { id: "compare", label: "Compare the options", style: "secondary" },
  ],
});

function fixture(onSubmit) {
  return reactFixture(
    "src/components/interactive-ui/InteractiveBlock.tsx",
    (module) => () => {
      const outer = module.InteractiveBlock({ block: nextSteps, storageKey: null, onSubmit });
      const body = nodes(outer).find((node) => node.type?.name === "FormBody");
      return [outer, body ? body.type(body.props) : null];
    },
    {
      modules: {
        "@/lib/interactive-ui.mjs": interactive,
        "lucide-react": { Check: "check-icon" },
        "@/components/ui/checkbox": { Checkbox: "checkbox" },
        "@/components/ui/radio-group": { RadioGroup: "radiogroup", RadioGroupItem: "radio" },
        "@/components/ui/slider": { Slider: "slider" },
        "@/components/ui/switch": { Switch: "switch" },
        "@/components/ui/select": {},
      },
    },
  );
}

test("Intelligent Interface next-step buttons send one readable next message", async () => {
  const messages = [];
  const f = fixture((message) => messages.push(message));
  await f.flush();
  assert.ok(f.text().includes("Intelligent Interface"));
  const button = f.find("button", (node) => node.props.children === "Build my launch plan");
  // Two clicks before React commits must not submit the same answer twice.
  button.props.onClick();
  button.props.onClick();
  await f.flush();
  assert.deepEqual(messages, ["Choose your next step\nSelected: Build my launch plan"]);
  assert.equal(f.find("section").props["data-interactive-state"], "submitted");
  assert.equal(f.find("button").props.disabled, true);
});

test("read-only answers cannot submit and a rejected callback does not mark the choice sent", async () => {
  const readOnly = fixture(undefined);
  await readOnly.flush();
  const disabled = readOnly.find("button");
  assert.equal(disabled.props.disabled, true);
  disabled.props.onClick();
  assert.equal(readOnly.find("section").props["data-interactive-state"], "readonly");

  let calls = 0;
  const rejected = fixture(() => {
    calls += 1;
    if (calls === 1) throw new Error("fixture-rejection");
  });
  await rejected.flush();
  assert.throws(() => rejected.find("button").props.onClick(), /fixture-rejection/);
  await rejected.flush();
  assert.equal(rejected.find("section").props["data-interactive-state"], "open");
  await rejected.click("Build my launch plan");
  assert.equal(calls, 2);
  assert.equal(rejected.find("section").props["data-interactive-state"], "submitted");
});

test("a declined next message retains its draft and can be retried once chat is ready", async () => {
  let ready = false;
  let accepted = 0;
  const f = fixture(() => {
    if (!ready) return false;
    accepted += 1;
    return true;
  });
  await f.flush();
  await f.click("Build my launch plan");
  assert.equal(accepted, 0);
  assert.equal(f.find("section").props["data-interactive-state"], "open");
  assert.ok(f.text().includes("Your response was not sent"));
  ready = true;
  const button = f.find("button");
  button.props.onClick();
  button.props.onClick();
  await f.flush();
  assert.equal(accepted, 1);
  assert.equal(f.find("section").props["data-interactive-state"], "submitted");
});

test("next steps retain the closed schema and cannot execute model-supplied actions", () => {
  assert.equal(interactive.INTELLIGENT_INTERFACE_NAME, "Intelligent Interface");
  assert.ok(interactive.INTERACTIVE_UI_INSTRUCTIONS.startsWith("Intelligent Interface:"));
  const block = "```kova-interactive\n" + JSON.stringify(nextSteps) + "\n```";
  assert.equal(interactive.splitInteractiveContent(block)[0].kind, "interactive");
  for (const extra of [{ href: "https://example.test" }, { onClick: "run()" }]) {
    assert.equal(
      interactive.validateInteractiveBlock({
        ...nextSteps,
        actions: [{ ...nextSteps.actions[0], ...extra }],
      }),
      null,
    );
  }
});
