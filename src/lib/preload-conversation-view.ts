// Opening a long chat should not wait for code to download. These chunks are
// fetched once, in the background, so the first message is ready immediately.
let started = false;

export const loadActiveChatTranscript = () => import("@/components/ActiveChatTranscript");

export function preloadConversationView() {
  if (started || typeof window === "undefined") return;
  started = true;
  const warm = () => {
    void loadActiveChatTranscript();
    void import("@/components/ChatMessage");
    void import("@/components/ChatChart");
    void import("@/components/ResponseBrowserCard");
    void import("@/components/ChatStudyControl");
  };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number })
    .requestIdleCallback;
  if (idle) idle(warm);
  else window.setTimeout(warm, 800);
}
