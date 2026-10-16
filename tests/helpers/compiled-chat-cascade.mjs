// Bounded CSS-cascade evaluator for chat geometry. No DOM layout/rendering claim.
// Uses parsed selectors, layer/importance order, specificity, inheritance and media/container conditions.
import postcss from "postcss";
import * as csstree from "css-tree";
export function compiledCascade(
  text,
  viewport,
  coarse = false,
  mainWidth = viewport,
  containers = {},
  viewportHeight = 761,
) {
  const css = postcss.parse(text),
    layers = [],
    rules = [];
  let order = 0;
  css.walkAtRules("layer", (n) => {
    for (const name of n.params.split(",")) {
      if (!layers.includes(name.trim())) layers.push(name.trim());
    }
  });
  const list = (n) => n?.children ?? [];
  const specificity = (n) => {
    if (n.type === "IdSelector") return [1, 0, 0];
    if (n.type === "ClassSelector" || n.type === "AttributeSelector") return [0, 1, 0];
    if (n.type === "TypeSelector") return [0, 0, n.name === "*" ? 0 : 1];
    if (n.type === "PseudoClassSelector") {
      if (n.name === "where") return [0, 0, 0];
      if (["is", "not", "has"].includes(n.name))
        return list(list(n)[0]).map(specificity).sort(compare).at(-1) ?? [0, 0, 0];
      return [0, 1, 0];
    }
    return list(n).reduce((a, c) => specificity(c).map((v, i) => a[i] + v), [0, 0, 0]);
  };
  function compare(a, b) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
  }
  function match(selector, el) {
    const parts = [[]],
      combs = [];
    for (const n of list(selector)) {
      if (n.type === "Combinator") {
        combs.push(n.name);
        parts.push([]);
      } else parts.at(-1).push(n);
    }
    function simple(n, e) {
      if (n.type === "ClassSelector") return e.classes.includes(n.name);
      if (n.type === "TypeSelector") return n.name === "*" || n.name === e.tag;
      if (n.type === "IdSelector") return e.attrs.id === n.name;
      if (n.type === "AttributeSelector") {
        const value = e.attrs[n.name.name];
        return (
          value !== undefined &&
          (!n.matcher || (n.matcher === "=" && value === (n.value.value ?? n.value.name)))
        );
      }
      if (n.type === "PseudoClassSelector") {
        if (n.name === "root") return !e.parent;
        if (n.name === "first-child") return e.parent?.children[0] === e;
        if (["is", "where", "not"].includes(n.name)) {
          const yes = list(list(n)[0]).some((s) => match(s, e));
          return n.name === "not" ? !yes : yes;
        }
        if (n.name === "has") {
          const descend = (x) =>
            x.children.some((c) => list(list(n)[0]).some((s) => match(s, c)) || descend(c));
          return descend(e);
        }
        return false; // This fixture has no hover/focus/disabled or structural pseudo-state.
      }
      return false;
    }
    function part(i, e) {
      if (!e || !parts[i].every((n) => simple(n, e))) return false;
      if (i === 0) return true;
      if (combs[i - 1] === ">") return part(i - 1, e.parent);
      if (combs[i - 1] === " ") {
        for (let p = e.parent; p; p = p.parent) if (part(i - 1, p)) return true;
      }
      return false;
    }
    return part(parts.length - 1, el);
  }
  function conditions(node) {
    for (let p = node.parent; p; p = p.parent) {
      if (p.type !== "atrule" || !["media", "container"].includes(p.name)) continue;
      const container = p.name === "container";
      const width = container
        ? (containers[p.params.split(" ")[0]] ??
          (p.params.startsWith("chat-canvas")
            ? mainWidth
            : Math.min(mainWidth - (viewport < 640 ? 32 : 40), mainWidth >= 856 ? 768 : 640)))
        : viewport;
      const ok = p.params.split(",").some((query) => {
        let found = false;
        const tests = [...query.matchAll(/\(([^()]*)\)/g)].map(([, raw]) => {
          found = true;
          const q = raw.trim();
          let m;
          if ((m = q.match(/^(min|max)-(width|height)\s*:\s*([\d.]+)(px|rem)$/))) {
            const n = +m[3] * (m[4] === "rem" ? 16 : 1),
              actual = m[2] === "width" ? width : viewportHeight;
            return m[1] === "min" ? actual >= n : actual <= n;
          }
          if ((m = q.match(/^(width|height)\s*(>=|<=|>|<)\s*([\d.]+)(px|rem)$/))) {
            const n = +m[3] * (m[4] === "rem" ? 16 : 1),
              actual = m[1] === "width" ? width : viewportHeight;
            return { ">=": actual >= n, "<=": actual <= n, ">": actual > n, "<": actual < n }[m[2]];
          }
          if ((m = q.match(/^pointer\s*:\s*(coarse|fine)$/))) return (m[1] === "coarse") === coarse;
          if (q === "hover:hover" || q === "hover: hover") return !coarse;
          if (/prefers-reduced-motion\s*:\s*no-preference/.test(q)) return true;
          return false;
        });
        return found && tests.every(Boolean);
      });
      if (!ok) return false;
    }
    return true;
  }
  css.walkRules((rule) => {
    let selectors;
    try {
      selectors = csstree.toPlainObject(
        csstree.parse(rule.selector, { context: "selectorList" }),
      ).children;
    } catch {
      return;
    }
    let layer = null;
    for (let p = rule.parent; p; p = p.parent)
      if (p.type === "atrule" && p.name === "layer") layer = p.params;
    for (const decl of rule.nodes.filter((n) => n.type === "decl")) {
      const important = Boolean(decl.important),
        rank = important
          ? layer === null
            ? -1
            : layers.length - layers.indexOf(layer)
          : layer === null
            ? layers.length
            : layers.indexOf(layer);
      rules.push({ rule, selectors, decl, rank, important, order: order++ });
    }
  });
  function winner(el, prop) {
    let best;
    for (const r of rules) {
      if (r.decl.prop !== prop || !conditions(r.rule)) continue;
      for (const s of r.selectors) {
        if (!match(s, el)) continue;
        const score = [+r.important, r.rank, ...specificity(s), r.order];
        if (!best || compare(score, best.score) > 0)
          best = { value: r.decl.value, selector: r.rule.selector, score };
      }
    }
    return best;
  }
  function value(el, prop) {
    const w = winner(el, prop);
    if (!w) return prop.startsWith("--") && el.parent ? value(el.parent, prop) : undefined;
    return resolve(el, w.value);
  }
  function resolve(el, text) {
    let result = text;
    while (result?.includes("var(")) {
      const start = result.indexOf("var(");
      let end = start + 4,
        depth = 1;
      for (; depth && end < result.length; end++) {
        if (result[end] === "(") depth++;
        if (result[end] === ")") depth--;
      }
      const content = result.slice(start + 4, end - 1);
      let comma = -1,
        d = 0;
      for (let i = 0; i < content.length; i++) {
        if (content[i] === "(") d++;
        if (content[i] === ")") d--;
        if (content[i] === "," && d === 0) {
          comma = i;
          break;
        }
      }
      const name = (comma < 0 ? content : content.slice(0, comma)).trim(),
        fallback = comma < 0 ? "" : content.slice(comma + 1).trim();
      result =
        result.slice(0, start) + (value(el, name) ?? resolve(el, fallback)) + result.slice(end);
    }
    return result;
  }
  return { value, winner };
}
export function element(tag, classes = "", parent = null, attrs = {}) {
  const e = { tag, classes: classes.split(" "), parent, attrs, children: [] };
  parent?.children.push(e);
  return e;
}
