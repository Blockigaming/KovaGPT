type TextReadingAnchor = {
  node: Text;
  offset: number;
  signature: string;
  viewportOffset: number;
};

export type TranscriptReadingAnchor =
  | { kind: "start" }
  | { kind: "end" }
  | {
      kind: "content";
      messageId: string;
      messageOffset: number;
      previousTop: number;
      text: TextReadingAnchor | null;
    };

export type ReadingAnchorRestoration = {
  applied: boolean;
  clamped: boolean;
  reason: string;
  top: number;
};

const EPSILON = 0.25;
const messages = (element: HTMLElement) =>
  Array.from(element.querySelectorAll<HTMLElement>("[data-message-id]"));

function viewport(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top + element.clientTop,
    bottom: rect.top + element.clientTop + element.clientHeight,
    left: rect.left + element.clientLeft,
    right: rect.left + element.clientLeft + element.clientWidth,
    visible: element.clientWidth > 0 && element.clientHeight > 0 && rect.height > 0,
  };
}

function textNodes(message: HTMLElement): Text[] {
  const walker = message.ownerDocument.createTreeWalker(message, 4);
  const result: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (
      text.data.trim() &&
      !text.parentElement?.closest(
        'button, input, textarea, select, svg, script, style, [aria-hidden="true"], [hidden]',
      )
    )
      result.push(text);
  }
  return result;
}

function characterRect(node: Text, offset: number) {
  if (!node.data.length) return null;
  const range = node.ownerDocument.createRange();
  range.setStart(node, Math.max(0, Math.min(offset, node.data.length - 1)));
  range.setEnd(node, Math.max(1, Math.min(offset + 1, node.data.length)));
  return (
    Array.from(range.getClientRects()).find((rect) => rect.height > 0 && rect.width > 0) ?? null
  );
}

function captureText(
  message: HTMLElement,
  view: ReturnType<typeof viewport>,
): TextReadingAnchor | null {
  for (const node of textNodes(message)) {
    const range = node.ownerDocument.createRange();
    range.selectNodeContents(node);
    const visible = Array.from(range.getClientRects()).some(
      (rect) =>
        rect.height > 0 &&
        rect.width > 0 &&
        rect.bottom > view.top + EPSILON &&
        rect.top < view.bottom &&
        rect.right > view.left &&
        rect.left < view.right,
    );
    if (!visible) continue;

    // Prefix rectangles keep the search monotonic across whitespace/newlines.
    let low = 0;
    let high = node.data.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      range.setStart(node, 0);
      range.setEnd(node, middle + 1);
      const bottom = Math.max(...Array.from(range.getClientRects(), (rect) => rect.bottom));
      if (bottom <= view.top + EPSILON) low = middle + 1;
      else high = middle;
    }
    for (let offset = low; offset < node.data.length; offset++) {
      const rect = characterRect(node, offset);
      if (!rect || rect.bottom <= view.top + EPSILON) continue;
      if (rect.top >= view.bottom) break;
      if (rect.right <= view.left || rect.left >= view.right) continue;
      return {
        node,
        offset,
        signature: node.data.slice(offset, offset + 32),
        viewportOffset: rect.top - view.top,
      };
    }
  }
  return null;
}

export function captureTranscriptReadingAnchor(
  element: HTMLElement,
  followingBottom = false,
): TranscriptReadingAnchor | null {
  const view = viewport(element);
  if (!view.visible) return null;
  if (followingBottom) return { kind: "end" };
  if (element.scrollTop <= EPSILON) return { kind: "start" };
  const message = messages(element).find((candidate) => {
    const rect = candidate.getBoundingClientRect();
    return rect.bottom > view.top + EPSILON && rect.top < view.bottom;
  });
  if (!message?.dataset.messageId) return null;
  return {
    kind: "content",
    messageId: message.dataset.messageId,
    messageOffset: message.getBoundingClientRect().top - view.top,
    previousTop: element.scrollTop,
    text: captureText(message, view),
  };
}

function currentTextRect(message: HTMLElement, anchor: TextReadingAnchor) {
  if (
    message.contains(anchor.node) &&
    anchor.node.data.slice(anchor.offset, anchor.offset + anchor.signature.length) ===
      anchor.signature
  )
    return characterRect(anchor.node, anchor.offset);
  // React may replace a text node without changing the rendered passage.
  const nodes = textNodes(message);
  for (const node of nodes) {
    if (
      node.data.slice(anchor.offset, anchor.offset + anchor.signature.length) === anchor.signature
    )
      return characterRect(node, anchor.offset);
  }
  for (const node of nodes) {
    const offset = node.data.indexOf(anchor.signature);
    if (offset !== -1) return characterRect(node, offset);
  }
  return null;
}

export function restoreTranscriptReadingAnchor(
  element: HTMLElement,
  anchor: TranscriptReadingAnchor,
): ReadingAnchorRestoration {
  const view = viewport(element);
  if (!view.visible)
    return { applied: false, clamped: false, reason: "hidden", top: element.scrollTop };
  const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
  let wanted = 0;
  let reason: string = anchor.kind;
  if (anchor.kind === "end") wanted = maximum;
  if (anchor.kind === "content") {
    const message = messages(element).find(
      (candidate) => candidate.dataset.messageId === anchor.messageId,
    );
    if (!message) {
      wanted = anchor.previousTop;
      reason = "message-removed";
    } else {
      const textRect = anchor.text ? currentTextRect(message, anchor.text) : null;
      const difference = textRect
        ? textRect.top - view.top - anchor.text!.viewportOffset
        : message.getBoundingClientRect().top - view.top - anchor.messageOffset;
      wanted = element.scrollTop + difference;
      reason = textRect ? "text-line" : "message-fallback";
    }
  }
  const top = Math.max(0, Math.min(maximum, wanted));
  const applied = Math.abs(top - element.scrollTop) > EPSILON;
  if (applied) {
    // The transcript has scroll-smooth for explicit navigation. Compensation is instant.
    const previous = element.style.scrollBehavior;
    element.style.scrollBehavior = "auto";
    element.scrollTop = top;
    element.style.scrollBehavior = previous;
  }
  return { applied, clamped: top !== wanted, reason, top: element.scrollTop };
}

export function createTranscriptReadingAnchorController(
  element: HTMLElement,
  options: { isCurrent: () => boolean; isFollowingBottom: () => boolean },
) {
  const window = element.ownerDocument.defaultView;
  let disposed = false;
  let anchor = captureTranscriptReadingAnchor(element, options.isFollowingBottom());
  let captureFrame: number | null = null;
  let intentFrame: number | null = null;
  let knownTop = element.scrollTop;
  let userIntentPending = false;
  let gestureActive = false;
  const sizes = new Map<Element, [number, number]>();
  const previousOverflowAnchor = element.style.overflowAnchor;
  // This controller coordinates all observed transcript/message reflows, avoiding
  // a second UA adjustment while keeping the existing explicit bottom-follow policy.
  element.style.overflowAnchor = "none";
  const current = () => !disposed && options.isCurrent();
  const cancelCapture = () => {
    if (captureFrame !== null) window?.cancelAnimationFrame(captureFrame);
    captureFrame = null;
  };
  const cancelIntent = () => {
    if (intentFrame !== null) window?.cancelAnimationFrame(intentFrame);
    intentFrame = null;
    userIntentPending = false;
  };
  const capture = (followingBottom = anchor?.kind === "end") => {
    cancelCapture();
    cancelIntent();
    if (!current()) return;
    const next = captureTranscriptReadingAnchor(element, followingBottom);
    if (next) anchor = next;
    knownTop = element.scrollTop;
  };
  const queueCapture = () => {
    if (!current() || captureFrame !== null) return;
    captureFrame =
      window?.requestAnimationFrame(() => {
        captureFrame = null;
        capture(options.isFollowingBottom());
      }) ?? null;
  };
  const compensate = () => {
    if (!current() || captureFrame !== null || !anchor) return;
    const result = restoreTranscriptReadingAnchor(element, anchor);
    knownTop = result.top;
    if (result.clamped || result.reason === "message-removed") capture();
  };
  const layoutChanged = () => {
    for (const [target, previous] of sizes) {
      const rect = target.getBoundingClientRect();
      if (previous[0] !== rect.width || previous[1] !== rect.height) return true;
    }
    return false;
  };
  const onScroll = () => {
    if (!current()) return;
    if (Math.abs(element.scrollTop - knownTop) <= EPSILON) return;
    // UA clamping can dispatch scroll before ResizeObserver. Preserve the cached
    // pre-reflow passage rather than capturing the already shifted viewport.
    // Other changed scroll positions remain real navigation, including momentum.
    const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
    if (!userIntentPending && !gestureActive && knownTop > maximum && layoutChanged()) {
      compensate();
      return;
    }
    knownTop = element.scrollTop;
    queueCapture();
  };
  const onIntent = (event: Event) => {
    if (
      event.type === "keydown" &&
      !["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(
        (event as KeyboardEvent).key,
      )
    )
      return;
    if (event.type === "touchstart" || event.type === "pointerdown") gestureActive = true;
    else {
      userIntentPending = true;
      if (intentFrame === null)
        intentFrame =
          window?.requestAnimationFrame(() => {
            intentFrame = null;
            userIntentPending = false;
          }) ?? null;
    }
  };
  const onGestureEnd = () => {
    gestureActive = false;
  };
  const observer = window?.ResizeObserver
    ? new window.ResizeObserver((entries) => {
        let changed = false;
        for (const entry of entries) {
          const rect = entry.target.getBoundingClientRect();
          const previous = sizes.get(entry.target);
          if (previous && (previous[0] !== rect.width || previous[1] !== rect.height))
            changed = true;
          sizes.set(entry.target, [rect.width, rect.height]);
        }
        if (changed) compensate();
      })
    : null;
  const observe = (target: HTMLElement) => {
    if (sizes.has(target)) return;
    const rect = target.getBoundingClientRect();
    sizes.set(target, [rect.width, rect.height]);
    observer?.observe(target);
  };
  const syncMessages = () => {
    const targets = new Set<Element>([element, ...messages(element)]);
    for (const target of sizes.keys()) {
      if (!targets.has(target)) {
        observer?.unobserve(target);
        sizes.delete(target);
      }
    }
    for (const target of targets) observe(target as HTMLElement);
  };
  syncMessages();
  const mutations = window?.MutationObserver
    ? new window.MutationObserver(() => {
        if (!current()) return;
        syncMessages();
        compensate();
      })
    : null;
  mutations?.observe(element, { childList: true, subtree: true });
  element.addEventListener("scroll", onScroll, { passive: true });
  for (const type of ["wheel", "touchstart", "pointerdown", "keydown"])
    element.addEventListener(type, onIntent, { passive: true });
  for (const type of ["touchend", "touchcancel", "pointerup", "pointercancel"])
    window?.addEventListener(type, onGestureEnd, { passive: true });
  window?.addEventListener("resize", compensate);
  return {
    capture() {
      // Keep the same character across successive reflows. Recapturing a new
      // first character after wrapping would accumulate one-line drift. A numeric
      // near-bottom change from compensation must not promote content to end.
      if (!anchor || captureFrame !== null || Math.abs(element.scrollTop - knownTop) > EPSILON)
        capture(options.isFollowingBottom());
    },
    followEnd: () => capture(true),
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelCapture();
      cancelIntent();
      observer?.disconnect();
      mutations?.disconnect();
      sizes.clear();
      element.removeEventListener("scroll", onScroll);
      for (const type of ["wheel", "touchstart", "pointerdown", "keydown"])
        element.removeEventListener(type, onIntent);
      for (const type of ["touchend", "touchcancel", "pointerup", "pointercancel"])
        window?.removeEventListener(type, onGestureEnd);
      window?.removeEventListener("resize", compensate);
      element.style.overflowAnchor = previousOverflowAnchor;
    },
  };
}
