import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function card(file, name, initialProps) {
  const state = [];
  let cursor = 0;
  const jsx = (type, props) => ({ type, props });
  const modules = {
    react: {
      useId: () => "private-card",
      useState: (initial) => {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [
          state[index],
          (value) => {
            state[index] = value;
          },
        ];
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "lucide-react": { LockKeyhole: "svg" },
    "@/components/ui/input": { Input: "input" },
    "@/components/ui/button": { Button: "button" },
    "@/components/ui/textarea": { Textarea: "textarea" },
  };
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      exports,
      require: (module) => {
        assert.ok(module in modules, module);
        return modules[module];
      },
    },
  );
  let props = initialProps;
  const all = (node) =>
    !node || typeof node !== "object"
      ? []
      : Array.isArray(node)
        ? node.flatMap(all)
        : [node, ...all(node.props?.children)];
  const render = () => {
    cursor = 0;
    return exports[name](props);
  };
  return {
    tree: render,
    find: (type, predicate = () => true) =>
      all(render()).find((node) => node.type === type && predicate(node)),
    setProps: (value) => {
      props = { ...props, ...value };
    },
  };
}
test("private password card clears the entry before handing it off and never submits while disabled", () => {
  const entries = [];
  const f = card("src/components/BrowserPrivateEntryCard.tsx", "BrowserPrivateEntryCard", {
    origin: "example.com",
    label: "Password",
    disabled: false,
    onFill: (value) => {
      assert.equal(f.find("input").props.value, "");
      entries.push(value);
    },
    onCancel: () => {
      assert.equal(f.find("input").props.value, "");
    },
  });
  assert.equal(f.find("input").props.type, "password");
  f.find("input").props.onChange({ target: { value: "synthetic-password" } });
  f.tree().props.onSubmit({ preventDefault() {} });
  assert.deepEqual(entries, ["synthetic-password"]);
  f.find("input").props.onChange({ target: { value: "discard-me" } });
  f.setProps({ disabled: true });
  f.tree().props.onSubmit({ preventDefault() {} });
  assert.equal(entries.length, 1);
  f.setProps({ disabled: false });
  f.find("button", (node) => node.props.type === "button").props.onClick();
  assert.equal(f.find("input").props.value, "");
});
test("question card submits the selected answer and replaces it when a custom answer is typed", () => {
  const answers = [];
  const f = card("src/components/WorkQuestionCard.tsx", "WorkQuestionCard", {
    question: {
      id: "question-one",
      text: "How should we continue?",
      options: ["Work together", "Show answer"],
    },
    disabled: false,
    onAnswer: (value) => answers.push(value),
  });
  assert.equal(f.find("button").props.disabled, true);
  f.find("input", (node) => node.props.value === 1).props.onChange();
  f.tree().props.onSubmit({ preventDefault() {} });
  assert.deepEqual(answers, ["Show answer"]);
  f.find("textarea").props.onChange({ target: { value: "  Explain step one  " } });
  assert.equal(f.find("input", (node) => node.props.value === 1).props.checked, false);
  f.tree().props.onSubmit({ preventDefault() {} });
  assert.deepEqual(answers, ["Show answer", "Explain step one"]);
  f.setProps({ disabled: true });
  f.tree().props.onSubmit({ preventDefault() {} });
  assert.equal(answers.length, 2);
});
