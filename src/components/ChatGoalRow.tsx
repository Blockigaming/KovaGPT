import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Pause, Pencil, Play, Target, X } from "lucide-react";
import { readChatGoal, subscribeChatGoal, writeChatGoal } from "@/lib/chat-goal";
import "./composer-voice.css";

/**
 * The conversation goal, shown above the message box: pause, resume, edit or clear it.
 * While active it is sent with each message so replies keep working toward it.
 */
export function ChatGoalRow({
  principal,
  chatId,
  editing,
  onEditingChange,
}: {
  principal: string | null;
  chatId: string | null;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}) {
  const snapshot = useSyncExternalStore(
    subscribeChatGoal,
    () => JSON.stringify(readChatGoal(principal, chatId)),
    () => "null",
  );
  const goal = JSON.parse(snapshot) as ReturnType<typeof readChatGoal>;
  const [draft, setDraft] = useState("");
  const inputId = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!editing) return;
    setDraft(goal?.text ?? "");
    window.requestAnimationFrame(() => input.current?.focus());
    // Only reset the draft when editing starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  if (editing)
    return (
      <form
        className="kova-goal-row"
        data-editing=""
        onSubmit={(event) => {
          event.preventDefault();
          writeChatGoal(
            principal,
            chatId,
            draft.trim() ? { text: draft, paused: false, setAt: Date.now() } : null,
          );
          onEditingChange(false);
        }}
      >
        <Target aria-hidden="true" />
        <label htmlFor={inputId} className="sr-only">
          Goal for this chat
        </label>
        <textarea
          id={inputId}
          ref={input}
          rows={1}
          maxLength={500}
          value={draft}
          placeholder="What should this chat accomplish?"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
            if (event.key === "Escape") onEditingChange(false);
          }}
        />
        <button type="submit">Save</button>
        <button type="button" onClick={() => onEditingChange(false)}>
          Cancel
        </button>
      </form>
    );
  if (!goal) return null;
  return (
    <div
      className="kova-goal-row"
      data-paused={goal.paused || undefined}
      role="region"
      aria-label="Chat goal"
    >
      <Target aria-hidden="true" />
      <span className="kova-goal-text" dir="auto">
        <span className="kova-goal-label">{goal.paused ? "Goal paused" : "Goal"}</span> {goal.text}
      </span>
      <button
        type="button"
        aria-label={goal.paused ? "Resume goal" : "Pause goal"}
        title={goal.paused ? "Resume" : "Pause"}
        onClick={() => writeChatGoal(principal, chatId, { ...goal, paused: !goal.paused })}
      >
        {goal.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
      </button>
      <button
        type="button"
        aria-label="Edit goal"
        title="Edit"
        onClick={() => onEditingChange(true)}
      >
        <Pencil aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Clear goal"
        title="Clear"
        onClick={() => writeChatGoal(principal, chatId, null)}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  );
}
