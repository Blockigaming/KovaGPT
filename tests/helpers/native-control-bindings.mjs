// Explicit DOM boundaries for the three transparent, forward-ref UI controls.
// Hook fixtures exercise caller callbacks, refs, disabled state and children;
// the real primitive/browser suites own class variants, layout and rendering.
const Button = Symbol("fixture-shared-button");
const Input = Symbol("fixture-shared-input");
const Textarea = Symbol("fixture-shared-textarea");

export const nativeControlModules = {
  "@/components/ui/button": { Button },
  "@/components/ui/input": { Input },
  "@/components/ui/textarea": { Textarea },
};

const assignRef = (ref, value) => {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
};

export function fixtureElement(type, props = {}, key) {
  if (type === Input) type = "input";
  else if (type === Textarea) type = "textarea";
  else if (type === Button) {
    if (props.asChild) {
      const { asChild: _asChild, children: child, ...outer } = props;
      if (!child || Array.isArray(child) || typeof child !== "object" || !child.props)
        throw new Error("A shared asChild Button fixture requires exactly one element child");
      const merged = { ...outer, ...child.props };
      // Match the installed Radix Slot contract: child handlers run first,
      // style/class merge, and both child and forwarded refs receive the node.
      for (const [name, value] of Object.entries(child.props)) {
        if (/^on[A-Z]/.test(name) && value && outer[name]) {
          merged[name] = (...args) => {
            const result = value(...args);
            outer[name](...args);
            return result;
          };
        }
      }
      if (outer.className || child.props.className)
        merged.className = [outer.className, child.props.className].filter(Boolean).join(" ");
      if (outer.style || child.props.style) merged.style = { ...outer.style, ...child.props.style };
      if (outer.ref && child.props.ref)
        merged.ref = (value) => {
          assignRef(outer.ref, value);
          assignRef(child.props.ref, value);
        };
      return { type: child.type, props: merged, key: child.key ?? key };
    }
    type = "button";
  }
  return { type, props, key };
}
