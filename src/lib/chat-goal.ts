import { safeBrowserStorage } from "./principal-browser-storage.mjs";

/** A goal the user set for one conversation. Kept on this device only. */
export type ChatGoal = { text: string; paused: boolean; setAt: number };

const PREFIX = "kova-chat-goal:";
const CHANGED = "kova:chat-goal-changed";
const keyFor = (principal: string | null, chatId: string | null) =>
  `${PREFIX}${principal ?? "guest"}:${chatId ?? "draft"}`;

export function readChatGoal(principal: string | null, chatId: string | null): ChatGoal | null {
  try {
    const raw = safeBrowserStorage("localStorage")?.getItem(keyFor(principal, chatId));
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (
      value &&
      typeof value === "object" &&
      typeof (value as ChatGoal).text === "string" &&
      (value as ChatGoal).text.trim()
    )
      return {
        text: (value as ChatGoal).text.slice(0, 500),
        paused: (value as ChatGoal).paused === true,
        setAt: Number((value as ChatGoal).setAt) || 0,
      };
  } catch {
    /* Unreadable storage means no goal. */
  }
  return null;
}

export function writeChatGoal(
  principal: string | null,
  chatId: string | null,
  goal: ChatGoal | null,
) {
  try {
    const storage = safeBrowserStorage("localStorage");
    if (goal?.text.trim())
      storage?.setItem(
        keyFor(principal, chatId),
        JSON.stringify({ ...goal, text: goal.text.trim().slice(0, 500) }),
      );
    else storage?.removeItem(keyFor(principal, chatId));
  } catch {
    /* Storage full or blocked: the goal simply isn't kept. */
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function subscribeChatGoal(listener: () => void) {
  window.addEventListener(CHANGED, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGED, listener);
    window.removeEventListener("storage", listener);
  };
}

/**
 * The active goal to send with a request. A goal set before a new chat had an id moves
 * to the chat's id on its first send. Paused goals are not sent.
 */
export function goalForRequest(principal: string | null, activeId: string | null, chatId: string) {
  let goal = readChatGoal(principal, activeId ?? chatId);
  if (!goal && !activeId) {
    goal = readChatGoal(principal, null);
    if (goal) {
      writeChatGoal(principal, chatId, goal);
      writeChatGoal(principal, null, null);
    }
  }
  return goal && !goal.paused ? goal.text : undefined;
}
