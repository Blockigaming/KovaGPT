import * as authRetry from "../../src/lib/auth-retry-delay.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync("src/routes/auth.tsx", "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const nodes = (node) =>
  !node || typeof node !== "object"
    ? []
    : Array.isArray(node)
      ? node.flatMap(nodes)
      : [node, ...nodes(node.props?.children)];

function fixture() {
  const state = [];
  let cursor = 0;
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const modules = {
    react: {
      useState(initial) {
        const index = cursor++;
        state[index] ??= { value: initial };
        return [
          state[index].value,
          (next) => {
            state[index].value = typeof next === "function" ? next(state[index].value) : next;
          },
        ];
      },
      useRef(initial) {
        const index = cursor++;
        state[index] ??= { current: initial };
        return state[index];
      },
      useEffect() {},
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "@tanstack/react-router": {
      createFileRoute: () => (options) => options,
      useSearch: () => ({ email: "synthetic@example.invalid", mode: "sign-in" }),
      useNavigate: () => () => {},
    },
    "lucide-react": {},
    sonner: { toast: { error() {}, success() {} } },
    "@/components/ui/button": { Button: "button" },
    "@/components/ui/input": { Input: "input" },
    "@/components/ui/label": { Label: "label" },
    "@/components/NovaLogo": { NovaLogo: "logo" },
    "@/components/auth/ForgotPasswordDialog": { ForgotPasswordDialog: "recovery-dialog" },
    "@/integrations/supabase/client": {},
    "@/lib/oauth-session": {},
    "@/lib/auth-retry-delay.mjs": authRetry,
    "@/lib/kova-auth-browser": { browserKovaAuthEnabled: () => true },
    "@/lib/kova-auth-passkey-browser": {},
    "@/lib/passkey-support": {},
    "@/lib/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    require(name) {
      assert.ok(Object.hasOwn(modules, name), `Unexpected import ${name}`);
      return modules[name];
    },
  });
  const render = () => {
    cursor = 0;
    return exports.Route.component();
  };
  const find = (id) => nodes(render()).find((node) => node.props.id === id);
  return { render, password: () => find("kova-auth-page-password") };
}

test("leaving the auto-focused empty password for recovery does not mark it invalid", () => {
  const view = fixture();
  assert.equal(view.password().props.autoFocus, true);
  assert.equal(view.password().props["aria-invalid"], false);
  view.password().props.onBlur();
  const trigger = nodes(view.render()).find((node) => node.props.children === "Forgot password?");
  trigger.props.onClick();
  assert.equal(view.password().props["aria-invalid"], false);
  const dialog = nodes(view.render()).find((node) => node.type === "recovery-dialog");
  assert.equal(dialog.props.open, true);
  const form = nodes(view.render()).find((node) => node.type === "form");
  assert.equal(
    nodes(form).some((node) => node.type === "recovery-dialog"),
    false,
  );
  dialog.props.onOpenChange(false);
  assert.equal(view.password().props["aria-invalid"], false);
});

test("a short entered password validates on blur and a corrected password clears the error", () => {
  const view = fixture();
  view.password().props.onChange({ target: { value: "short" } });
  view.password().props.onBlur();
  assert.equal(view.password().props["aria-invalid"], true);
  view.password().props.onChange({ target: { value: "" } });
  assert.equal(view.password().props["aria-invalid"], true);
  view.password().props.onChange({ target: { value: "synthetic-long-password" } });
  assert.equal(view.password().props["aria-invalid"], false);
});

test("an attempted sign-in still marks an empty password invalid", async () => {
  const view = fixture();
  const form = nodes(view.render()).find((node) => node.type === "form");
  await form.props.onSubmit({ preventDefault() {} });
  assert.equal(view.password().props["aria-invalid"], true);
});
