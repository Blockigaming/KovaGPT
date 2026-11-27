import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * A lazy component whose chunk can be fetched before it first renders. Once the
 * chunk has loaded, React receives an already-settled thenable, so the first
 * send from Home swaps straight to the transcript instead of suspending the
 * whole pane behind the loading placeholder while the chunk downloads.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors React.lazy's own bound
function preloadableLazy<C extends ComponentType<any>>(
  load: () => Promise<{ default: C }>,
): [LazyExoticComponent<C>, () => Promise<unknown>] {
  let loaded: { default: C } | undefined;
  let pending: Promise<{ default: C }> | undefined;
  const preload = () =>
    (pending ??= load().then(
      (module) => (loaded = module),
      (error: unknown) => {
        pending = undefined;
        throw error;
      },
    ));
  const component = lazy(() => {
    const ready = loaded;
    if (!ready) return preload();
    const settled = {
      then(onFulfilled: (value: { default: C }) => unknown) {
        onFulfilled(ready);
        return settled;
      },
    };
    return settled as unknown as Promise<{ default: C }>;
  });
  return [component, preload];
}

export const [ActiveChatTranscript, preloadActiveChatTranscript] = preloadableLazy(() =>
  import("@/components/ActiveChatTranscript").then((module) => ({
    default: module.ActiveChatTranscript,
  })),
);

// Opening a long chat should not wait for code to download. These chunks are
// fetched once, in the background, so the first message is ready immediately.
// A failed warm-up (offline, interrupted request) is harmless: the chunk simply
// loads normally when the chat opens, so every rejection is swallowed.
let started = false;

export function preloadConversationView() {
  if (started || typeof window === "undefined") return;
  started = true;
  const warm = () => {
    for (const load of [preloadActiveChatTranscript, () => import("@/components/ChatMessage")])
      load().catch(() => {
        // Allow a later attempt if the network came back.
        started = false;
      });
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(warm, { timeout: 2500 });
  } else window.setTimeout(warm, 800);
}
