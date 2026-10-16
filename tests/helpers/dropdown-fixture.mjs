import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { loadUiModule } from "./ui-state-harness.mjs";
const names = [
  "Root",
  "Trigger",
  "Group",
  "Portal",
  "Sub",
  "RadioGroup",
  "SubTrigger",
  "SubContent",
  "Content",
  "Item",
  "CheckboxItem",
  "RadioItem",
  "Label",
  "Separator",
  "ItemIndicator",
];
const primitives = Object.fromEntries(
  names.map((name) => [name, Object.assign((props) => props, { displayName: name })]),
);
export const dropdown = loadUiModule("src/components/ui/dropdown-menu.tsx", {
  react: { forwardRef: (fn) => (props) => fn(props, null) },
  "@radix-ui/react-dropdown-menu": primitives,
  "lucide-react": { Check: "Check", ChevronRight: "ChevronRight", Circle: "Circle" },
  "@/lib/utils": { cn: (...values) => twMerge(clsx(values)) },
});
export const actionVariants = [
  ["Item", "menuitem"],
  ["CheckboxItem", "menuitemcheckbox"],
  ["RadioItem", "menuitemradio"],
  ["SubTrigger", "menuitem"],
];
export const contentProps = (sub = false, className = "") => {
  const tree = dropdown[sub ? "DropdownMenuSubContent" : "DropdownMenuContent"]({ className });
  return (sub ? tree : tree.props.children).props;
};

const selectPrimitives = Object.fromEntries(
  [
    "Root",
    "Group",
    "Value",
    "Trigger",
    "Icon",
    "ScrollUpButton",
    "ScrollDownButton",
    "Content",
    "Portal",
    "Viewport",
    "Label",
    "Item",
    "ItemIndicator",
    "ItemText",
    "Separator",
  ].map((name) => [name, Object.assign((props) => props, { displayName: name })]),
);
export const select = loadUiModule("src/components/ui/select.tsx", {
  react: { forwardRef: (fn) => (props) => fn(props, null) },
  "@radix-ui/react-select": selectPrimitives,
  "lucide-react": { Check: "Check", ChevronDown: "ChevronDown", ChevronUp: "ChevronUp" },
  "@/lib/utils": { cn: (...values) => twMerge(clsx(values)) },
});
