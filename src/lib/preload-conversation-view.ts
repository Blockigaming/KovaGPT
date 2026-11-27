// Opening a long chat should not wait for code to download. These chunks are
// fetched once, in the background, so the first message is ready immediately.
// A failed warm-up (offline, interrupted request) is harmless: the chunk simply
// loads normally when the chat opens, so every rejection is swallowed.
let started = false;

export function preloadConversationView() {
  if (started || typeof window === "undefined") return;
  started = true;
  const warm = () => {
    for (const load of [
      () => import("@/components/ActiveChatTranscript"),
      () => import("@/components/ChatMessage"),
    ])
      load().catch(() => {
        // Allow a later attempt if the network came back.
        started = false;
      });
  };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number })
    .requestIdleCallback;
  if (idle) idle(warm);
  else window.setTimeout(warm, 800);
}
