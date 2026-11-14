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

function fixture(onSubmit, block = nextSteps) {
  return reactFixture(
    "src/components/interactive-ui/InteractiveBlock.tsx",
    (module) => () => {
      const outer = module.InteractiveBlock({ block, storageKey: null, onSubmit });
      const body = nodes(outer).find((node) => node.type?.name === "FormBody");
      if (!body) return [outer];
      const contents = body.type(body.props);
      // Exercise the real field callbacks; only the Radix DOM boundary is
      // substituted in the deterministic hook fixture.
      const fields = nodes(contents)
        .filter((node) => node.type?.name === "FieldControl")
        .map((node) => node.type(node.props));
      return [outer, contents, ...fields];
    },
    {
      modules: {
        "@/lib/interactive-ui.mjs": interactive,
        "./StudyCards": { StudyCards: () => null },
        "./ResponseDiagram": { ResponseDiagram: () => null },
        "./ResponsePattern": { ResponsePattern: () => null },
        "./ResponseFiles": { ResponseFiles: () => null },
        "./ResponseSpeech": { ResponseSpeech: () => null },
        "./ResponseMemoryGame": { ResponseMemoryGame: () => null },
        "./ResponseSimulation": { ResponseSimulation: () => null },
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

test("radio click remains selected across rapid date/text updates and submits the latest draft", async () => {
  const form = interactive.validateInteractiveBlock({
    version: 1,
    type: "form",
    id: "react-radix-state",
    title: "Reliable preferences",
    fields: [
      { id: "start", label: "Start date", kind: "date" },
      {
        id: "style",
        label: "Style",
        kind: "radio",
        options: [{ value: "a", label: "Detailed" }],
      },
      { id: "notes", label: "Notes", kind: "text" },
    ],
    submitLabel: "Submit preferences",
  });
  assert.ok(form);
  const messages = [];
  const f = fixture((message) => messages.push(message), form);
  await f.flush();

  // Model the Firefox ordering: change a preceding field, click the Radix
  // button, and then let its onValueChange callback fire on the same turn.
  const date = f.find("input", (node) => node.props.type === "date");
  date.props.onChange({ target: { value: "2026-11-05" } });
  const radio = f.find("radio");
  // Pointerdown commits selection first, even if the following Firefox
  // click only focuses the Radix item and no onValueChange event arrives.
  radio.props.onPointerDown({ button: 0 });
  await f.flush();
  assert.equal(f.find("radiogroup").props.value, "a");
  // Duplicate pointer/click/controlled changes must not unset it.
  f.find("radio").props.onClick();
  f.find("radiogroup").props.onValueChange("a");
  await f.flush();
  assert.equal(f.find("radiogroup").props.value, "a");

  const notes = f.find("input", (node) => node.props.type === "text");
  notes.props.onChange({ target: { value: "Keep this selection" } });
  await f.flush();
  assert.equal(f.find("radiogroup").props.value, "a");

  f.submit();
  await f.flush();
  assert.equal(messages.length, 1);
  assert.match(messages[0], /Start date: 2026-11-05/);
  assert.match(messages[0], /Style: Detailed/);
  assert.match(messages[0], /Notes: Keep this selection/);
});

test("a simulated rectangle updates its result and resets to the original inputs", async () => {
  const block = interactive.validateInteractiveBlock({
    version: 1,
    type: "simulation",
    id: "area",
    title: "Area",
    model: "rectangle",
    inputs: {
      width: { min: 1, max: 10, step: 1, value: 5 },
      height: { min: 1, max: 10, step: 1, value: 4 },
    },
  });
  const f = reactFixture(
    "src/components/interactive-ui/ResponseSimulation.tsx",
    (module) => () => module.ResponseSimulation({ block }),
  );
  await f.flush();
  assert.match(f.text(), /Area = 20/);
  f.find("input").props.onChange({ currentTarget: { valueAsNumber: 8 } });
  await f.flush();
  assert.match(f.text(), /Area = 32/);
  await f.click("Reset");
  assert.match(f.text(), /Area = 20/);
});

test("multiple-select and numerical quiz items reveal feedback and score locally", async () => {
  const block = interactive.validateInteractiveBlock({
    version: 1,
    type: "quiz",
    id: "practice",
    title: "Practice",
    cards: [
      {
        kind: "multiple",
        front: "Choose both factors.",
        back: "Both divide six.",
        options: [
          { value: "two", label: "2" },
          { value: "three", label: "3" },
        ],
        answer: ["two", "three"],
      },
      {
        kind: "number",
        front: "What is one third?",
        back: "About 0.333.",
        answer: 1 / 3,
        tolerance: 0.001,
      },
    ],
  });
  const f = reactFixture(
    "src/components/interactive-ui/StudyCards.tsx",
    (module) => () => module.StudyCards({ block }),
  );
  await f.flush();
  f.find("input", (n) => n.props.value === "two").props.onChange({
    currentTarget: { checked: true },
  });
  f.find("input", (n) => n.props.value === "three").props.onChange({
    currentTarget: { checked: true },
  });
  await f.flush();
  await f.click("Check answer");
  assert.match(f.text(), /Correct.*Both divide six/);
  await f.click("Next question");
  f.find("input").props.onChange({ currentTarget: { value: "0.333" } });
  await f.flush();
  await f.click("Check answer");
  await f.click("See score");
  assert.match(f.text(), /2 of 2 correct/);
});

test("an adaptive quiz can review only missed questions and grade a corrected order", async () => {
  const block = interactive.validateInteractiveBlock({
    version: 1,
    type: "quiz",
    id: "ordering",
    title: "Ordering practice",
    adaptive: true,
    cards: [
      {
        kind: "ordering",
        front: "Order the numbers.",
        back: "Two comes before three.",
        options: [
          { value: "two", label: "Two" },
          { value: "three", label: "Three" },
        ],
        answer: ["two", "three"],
      },
      { kind: "number", front: "Two plus two?", back: "Four.", answer: 4 },
    ],
  });
  const f = reactFixture(
    "src/components/interactive-ui/StudyCards.tsx",
    (module) => () => module.StudyCards({ block }),
  );
  await f.flush();
  await f.click("Three");
  await f.click("Two");
  await f.click("Check answer");
  assert.match(f.text(), /Incorrect/);
  await f.click("Next question");
  f.find("input").props.onChange({ currentTarget: { value: "4" } });
  await f.flush();
  await f.click("Check answer");
  await f.click("See score");
  await f.click("Review missed questions");
  assert.match(f.text(), /Question 1 of 1/);
  await f.click("Two");
  await f.click("Three");
  await f.click("Check answer");
  assert.match(f.text(), /Correct/);
  await f.click("See score");
  assert.match(f.text(), /1 of 1 correct/);
});

test("timed practice starts on request, expires correctly, and still has an untimed option", async () => {
  const block = interactive.validateInteractiveBlock({
    version: 1,
    type: "quiz",
    id: "timed",
    title: "Timed quiz",
    secondsPerQuestion: 5,
    cards: [{ front: "Two plus two?", back: "Four.", kind: "number", answer: 4 }],
  });
  let now = 1000;
  let tick;
  const globals = {
    Date: { now: () => now },
    window: {
      setInterval: (callback) => {
        tick = callback;
        return 1;
      },
      clearInterval: () => {},
    },
  };
  const run = () =>
    reactFixture(
      "src/components/interactive-ui/StudyCards.tsx",
      (module) => () => module.StudyCards({ block }),
      { globals },
    );
  const timed = run();
  await timed.flush();
  assert.doesNotMatch(timed.text(), /Two plus two/);
  await timed.click("Start timed practice");
  assert.match(timed.text(), /5 seconds left/);
  now += 5000;
  tick();
  await timed.flush();
  assert.match(timed.text(), /Time is up.*Four/);
  await timed.click("See score");
  assert.match(timed.text(), /0 of 1 correct/);
  const untimed = run();
  await untimed.flush();
  await untimed.click("Practice without timer");
  assert.match(untimed.text(), /Two plus two/);
  assert.doesNotMatch(untimed.text(), /seconds left/);
});

test("the memory game plays to completion and counts matching turns", async () => {
  const block = interactive.validateInteractiveBlock({
    version: 1,
    type: "memory-game",
    id: "pairs",
    title: "Find the pairs",
    pairs: [
      { first: "A", second: "a" },
      { first: "B", second: "b" },
    ],
  });
  assert.ok(block);
  const f = reactFixture(
    "src/components/interactive-ui/ResponseMemoryGame.tsx",
    (module) => () => module.ResponseMemoryGame({ block }),
    { globals: { Math: { floor: Math.floor, random: () => 0.999 } } },
  );
  await f.flush();
  await f.click("Start game");
  await f.click("Turn over card 1");
  await f.click("Turn over card 3");
  assert.match(f.text(), /do not match/);
  await f.click("Turn cards back over");
  await f.click("Turn over card 1");
  await f.click("Turn over card 2");
  await f.click("Turn over card 3");
  await f.click("Turn over card 4");
  assert.match(f.text(), /All pairs matched\. 3 turns\./);
  await f.click("Shuffle and restart");
  assert.match(f.text(), /0 of 2 pairs matched\. 0 turns\./);
});

test("science simulations compute displacement, probability, and concentration", async () => {
  const range = (value) => ({ min: 1, max: 20, step: 1, value });
  for (const [model, inputs, expected] of [
    [
      "constant-acceleration",
      { initialVelocity: range(3), acceleration: range(2), seconds: range(4) },
      /Displacement \(m\) = 28/,
    ],
    [
      "independent-events",
      { probability: { min: 0, max: 100, step: 1, value: 50 }, trials: range(2) },
      /Chance \(%\) = 75/,
    ],
    ["molarity", { moles: range(4), liters: range(2) }, /Concentration \(mol\/L\) = 2/],
  ]) {
    const block = interactive.validateInteractiveBlock({
      version: 1,
      type: "simulation",
      id: model,
      title: model,
      model,
      inputs,
    });
    assert.ok(block);
    const f = reactFixture(
      "src/components/interactive-ui/ResponseSimulation.tsx",
      (module) => () => module.ResponseSimulation({ block }),
    );
    await f.flush();
    assert.match(f.text(), expected);
  }
});
