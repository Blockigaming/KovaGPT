/**
 * Translates the app's interface text in place for a chosen language (spec §75).
 *
 * Only whole text nodes and placeholder/title/aria-label values that exactly match a known
 * interface label are replaced, so people's own words never change. Chat content, code,
 * form values and anything marked data-no-translate are skipped. Switching back to English
 * restores the original text.
 */
const SKIP =
  ".prose-chat, .kova-user-message, [data-message-role='user'], [data-no-translate], pre, code, kbd, textarea, input, select, [contenteditable='true'], script, style, svg, .kova-pasted-card-snippet, .kova-file-preview-body";
// Form fields have no translatable text of their own, but their placeholders are labels.
const WALK_SKIP =
  ".prose-chat, .kova-user-message, [data-message-role='user'], [data-no-translate], pre, code, kbd, [contenteditable='true'], script, style, svg, .kova-pasted-card-snippet, .kova-file-preview-body";
const ATTRIBUTES = ["placeholder", "title", "aria-label"] as const;

let dictionary: Record<string, string> = {};
let reverse = new Map<string, string>();
let observer: MutationObserver | null = null;
const original = new WeakMap<Node, string>();

function skipped(element: Element | null) {
  return !element || Boolean(element.closest(SKIP));
}

function translateText(node: Text) {
  const value = node.nodeValue ?? "";
  const trimmed = value.trim();
  if (!trimmed || skipped(node.parentElement)) return;
  const source = reverse.get(trimmed) ?? trimmed;
  const next = dictionary[source];
  if (!next || next === trimmed) return;
  if (!original.has(node)) original.set(node, source);
  node.nodeValue = value.replace(trimmed, next);
}

function translateAttributes(element: Element) {
  if (element.closest("[data-no-translate]")) return;
  for (const name of ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (!value) continue;
    const source = reverse.get(value) ?? value;
    const next = dictionary[source];
    if (next && next !== value) {
      element.setAttribute(`data-kova-i18n-${name}`, source);
      element.setAttribute(name, next);
    }
  }
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateText(root as Text);
    return;
  }
  if (!(root instanceof Element) && root !== document) return;
  if (root instanceof Element) {
    if (root.matches(WALK_SKIP) || root.closest(WALK_SKIP)) return;
    translateAttributes(root);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) =>
      node instanceof Element && node.matches(WALK_SKIP)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) translateText(node as Text);
    else translateAttributes(node as Element);
  }
}

function restore() {
  observer?.disconnect();
  observer = null;
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      const source = original.get(node);
      if (source) {
        const value = node.nodeValue ?? "";
        node.nodeValue = value.replace(value.trim(), source);
        original.delete(node);
      }
    } else {
      for (const name of ATTRIBUTES) {
        const source = (node as Element).getAttribute(`data-kova-i18n-${name}`);
        if (source) {
          (node as Element).setAttribute(name, source);
          (node as Element).removeAttribute(`data-kova-i18n-${name}`);
        }
      }
    }
  }
}

/** Applies a dictionary (English label → translation); an empty one restores English. */
export function applyInterfaceTranslation(next: Record<string, string>) {
  if (typeof document === "undefined") return;
  restore();
  dictionary = next;
  reverse = new Map(Object.entries(next).map(([english, translated]) => [translated, english]));
  if (!Object.keys(next).length) return;
  walk(document.body);
  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") translateText(record.target as Text);
      else if (record.type === "attributes") translateAttributes(record.target as Element);
      else record.addedNodes.forEach(walk);
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...ATTRIBUTES],
  });
}
