import { useId, useRef, useState } from "react";
import { validateGenerativeWidget, type GenerativeWidget } from "@/lib/generative-ui.mjs";
import { resultRevisionDiff } from "@/lib/result-revision-diff.mjs";
import "./generative-canvas.css";

export type GenerativeCanvasProps = {
  widget: GenerativeWidget;
  expanded?: boolean;
  onOpenEditor?: (content: string, kind: "writing" | "code", title: string) => void;
  onOpenCanvas?: (widget: GenerativeWidget, trigger?: HTMLElement) => void;
  onDraftChange?: (widget: GenerativeWidget) => void;
};

/** A bounded, local working draft. Rendering this component never writes to a service. */
export function GenerativeCanvas({
  widget,
  expanded = false,
  onOpenEditor,
  onOpenCanvas,
  onDraftChange,
}: GenerativeCanvasProps) {
  const [draft, setDraft] = useState<GenerativeWidget>(widget);
  const [applied, setApplied] = useState<GenerativeWidget>(widget);
  const [comparing, setComparing] = useState(false);
  const [notice, setNotice] = useState("");
  const original = useRef(widget);
  const sequence = useRef(0);
  const fieldId = useId();
  const changed = JSON.stringify(draft) !== JSON.stringify(applied);
  const differsFromOriginal = JSON.stringify(draft) !== JSON.stringify(original.current);
  const validated = validateGenerativeWidget(draft);
  const isText = draft.type === "document" || draft.type === "code";
  const originalText =
    original.current.type === "document" || original.current.type === "code"
      ? original.current.content
      : JSON.stringify(original.current, null, 2);
  const currentText = isText ? draft.content : JSON.stringify(draft, null, 2);
  const comparison = comparing ? resultRevisionDiff(originalText, currentText) : [];
  const update = (next: GenerativeWidget) => {
    setDraft(next);
    setNotice("");
  };
  const apply = () => {
    if (!validated) return;
    setDraft(validated);
    setApplied(validated);
    setNotice("Draft applied in this tab.");
    onDraftChange?.(validated);
  };
  const nextId = (prefix: string, used: string[]) => {
    let id;
    do id = `${prefix}-${++sequence.current}`;
    while (used.includes(id));
    return id;
  };

  return (
    <section
      className={`kova-generative-canvas${expanded ? " kova-generative-canvas-expanded" : ""}`}
      data-canvas-type={draft.type}
      aria-label={`${draft.title} workspace`}
    >
      <header className="kova-generative-heading">
        <div className="kova-generative-title">
          <span className="kova-generative-eyebrow">
            {draft.type === "code"
              ? "Code workspace"
              : draft.type === "timeline"
                ? "Project timeline"
                : draft.type === "board"
                  ? "Idea board"
                  : draft.type === "date"
                    ? "Date picker"
                    : "Writing workspace"}
          </span>
          <h3>{draft.title}</h3>
        </div>
        {!expanded && onOpenCanvas && !isText ? (
          <button
            type="button"
            disabled={!validated}
            onClick={(event) => validated && onOpenCanvas(validated, event.currentTarget)}
          >
            Open workspace
          </button>
        ) : isText && onOpenEditor ? (
          <button
            type="button"
            disabled={!validated}
            onClick={() =>
              onOpenEditor(draft.content, draft.type === "code" ? "code" : "writing", draft.title)
            }
          >
            Open in Canvas
          </button>
        ) : null}
      </header>

      <div className="kova-generative-body">
        {isText ? (
          <div className="kova-generative-text-editor">
            <label htmlFor={`${fieldId}-content`}>
              {draft.type === "code" ? `${draft.language} code` : "Editable draft"}
            </label>
            <textarea
              id={`${fieldId}-content`}
              className={draft.type === "code" ? "kova-generative-code" : ""}
              value={draft.content}
              maxLength={64000}
              spellCheck={draft.type !== "code"}
              onChange={(event) => update({ ...draft, content: event.target.value })}
            />
          </div>
        ) : draft.type === "date" ? (
          <div className="kova-generative-date">
            <label htmlFor={`${fieldId}-date`}>Selected date</label>
            <input
              id={`${fieldId}-date`}
              type="date"
              value={draft.value}
              min={draft.min}
              max={draft.max}
              aria-invalid={!validated}
              onChange={(event) => update({ ...draft, value: event.target.value })}
            />
            <p>{draft.value ? `Selected: ${draft.value}` : "Choose a date to start this draft."}</p>
          </div>
        ) : draft.type === "timeline" ? (
          <div className="kova-generative-timeline">
            <p className="kova-generative-summary">
              {draft.items.filter((item) => item.status === "done").length} of {draft.items.length}{" "}
              milestones complete
            </p>
            <ol>
              {draft.items.map((item, index) => (
                <li key={item.id}>
                  <span className="kova-generative-step" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div className="kova-generative-milestone">
                    <label htmlFor={`${fieldId}-${item.id}-title`}>Milestone {index + 1}</label>
                    <input
                      id={`${fieldId}-${item.id}-title`}
                      value={item.title}
                      maxLength={200}
                      onChange={(event) =>
                        update({
                          ...draft,
                          items: draft.items.map((entry) =>
                            entry.id === item.id ? { ...entry, title: event.target.value } : entry,
                          ),
                        })
                      }
                    />
                    <div className="kova-generative-dates">
                      <label>
                        Start
                        <input
                          type="date"
                          value={item.start}
                          max={item.end}
                          aria-label={`Start date for milestone ${index + 1}`}
                          onChange={(event) =>
                            update({
                              ...draft,
                              items: draft.items.map((entry) =>
                                entry.id === item.id
                                  ? { ...entry, start: event.target.value }
                                  : entry,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        End
                        <input
                          type="date"
                          value={item.end}
                          min={item.start}
                          aria-label={`End date for milestone ${index + 1}`}
                          onChange={(event) =>
                            update({
                              ...draft,
                              items: draft.items.map((entry) =>
                                entry.id === item.id
                                  ? { ...entry, end: event.target.value }
                                  : entry,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        Status
                        <select
                          value={item.status}
                          aria-label={`Status for milestone ${index + 1}`}
                          onChange={(event) => {
                            const value = event.target.value;
                            if (value !== "planned" && value !== "doing" && value !== "done")
                              return;
                            update({
                              ...draft,
                              items: draft.items.map((entry) =>
                                entry.id === item.id ? { ...entry, status: value } : entry,
                              ),
                            });
                          }}
                        >
                          <option value="planned">Planned</option>
                          <option value="doing">In progress</option>
                          <option value="done">Done</option>
                        </select>
                      </label>
                    </div>
                    <button
                      type="button"
                      disabled={draft.items.length === 1}
                      aria-label={`Remove milestone ${index + 1}`}
                      onClick={() =>
                        update({
                          ...draft,
                          items: draft.items.filter((entry) => entry.id !== item.id),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            <button
              type="button"
              disabled={draft.items.length >= 64}
              onClick={() => {
                const last = draft.items[draft.items.length - 1];
                update({
                  ...draft,
                  items: [
                    ...draft.items,
                    {
                      id: nextId(
                        "milestone",
                        draft.items.map((item) => item.id),
                      ),
                      title: "New milestone",
                      start: last.end,
                      end: last.end,
                      status: "planned",
                    },
                  ],
                });
              }}
            >
              Add milestone
            </button>
          </div>
        ) : (
          <div className="kova-generative-board">
            {draft.columns.map((column) => {
              const cards = draft.cards.filter((card) => card.columnId === column.id);
              return (
                <section key={column.id} aria-label={`${column.title} column`}>
                  <h4>
                    {column.title}
                    <span>{cards.length}</span>
                  </h4>
                  <ol>
                    {cards.map((card, index) => (
                      <li key={card.id}>
                        <label htmlFor={`${fieldId}-${card.id}-title`}>Idea {index + 1}</label>
                        <input
                          id={`${fieldId}-${card.id}-title`}
                          value={card.title}
                          maxLength={200}
                          onChange={(event) =>
                            update({
                              ...draft,
                              cards: draft.cards.map((entry) =>
                                entry.id === card.id
                                  ? { ...entry, title: event.target.value }
                                  : entry,
                              ),
                            })
                          }
                        />
                        <label htmlFor={`${fieldId}-${card.id}-body`}>Notes</label>
                        <textarea
                          id={`${fieldId}-${card.id}-body`}
                          value={card.body ?? ""}
                          maxLength={4000}
                          onChange={(event) =>
                            update({
                              ...draft,
                              cards: draft.cards.map((entry) =>
                                entry.id === card.id
                                  ? { ...entry, body: event.target.value }
                                  : entry,
                              ),
                            })
                          }
                        />
                        <label htmlFor={`${fieldId}-${card.id}-column`}>Move to</label>
                        <select
                          id={`${fieldId}-${card.id}-column`}
                          value={card.columnId}
                          onChange={(event) => {
                            const columnId = event.target.value;
                            if (draft.columns.some((entry) => entry.id === columnId))
                              update({
                                ...draft,
                                cards: draft.cards.map((entry) =>
                                  entry.id === card.id ? { ...entry, columnId } : entry,
                                ),
                              });
                          }}
                        >
                          {draft.columns.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.title}
                            </option>
                          ))}
                        </select>
                        <div className="kova-generative-card-actions">
                          {([-1, 1] as const).map((direction) => (
                            <button
                              key={direction}
                              type="button"
                              aria-label={`Move ${card.title} ${direction === -1 ? "up" : "down"}`}
                              disabled={index + direction < 0 || index + direction >= cards.length}
                              onClick={() => {
                                const other = cards[index + direction];
                                const next = [...draft.cards];
                                const from = next.findIndex((entry) => entry.id === card.id);
                                const to = next.findIndex((entry) => entry.id === other.id);
                                [next[from], next[to]] = [next[to], next[from]];
                                update({ ...draft, cards: next });
                              }}
                            >
                              {direction === -1 ? "Move up" : "Move down"}
                            </button>
                          ))}
                          <button
                            type="button"
                            aria-label={`Remove ${card.title}`}
                            onClick={() =>
                              update({
                                ...draft,
                                cards: draft.cards.filter((entry) => entry.id !== card.id),
                              })
                            }
                          >
                            Remove
                          </button>
                        </div>
                      </li>
                    ))}
                  </ol>
                  {!cards.length && <p className="kova-generative-empty">No ideas here yet.</p>}
                  <button
                    type="button"
                    disabled={draft.cards.length >= 64}
                    aria-label={`Add idea to ${column.title}`}
                    onClick={() =>
                      update({
                        ...draft,
                        cards: [
                          ...draft.cards,
                          {
                            id: nextId(
                              "idea",
                              draft.cards.map((card) => card.id),
                            ),
                            title: "New idea",
                            columnId: column.id,
                          },
                        ],
                      })
                    }
                  >
                    Add idea
                  </button>
                </section>
              );
            })}
          </div>
        )}

        {comparing && (
          <section className="kova-generative-comparison" aria-label="Changes from original">
            <h4>Changes from original</h4>
            {comparison.map((chunk, index) =>
              chunk.kind === "unchanged" ? (
                <pre key={index}>{chunk.after}</pre>
              ) : (
                <div key={index} className="kova-generative-change">
                  {chunk.before && (
                    <div>
                      <span>Before</span>
                      <pre>
                        <del>{chunk.before}</del>
                      </pre>
                    </div>
                  )}
                  {chunk.after && (
                    <div>
                      <span>After</span>
                      <pre>
                        <ins>{chunk.after}</ins>
                      </pre>
                    </div>
                  )}
                </div>
              ),
            )}
          </section>
        )}
      </div>

      <footer className="kova-generative-footer">
        <div className="kova-generative-actions">
          <button
            type="button"
            className="kova-generative-apply"
            disabled={!changed || !validated}
            onClick={apply}
          >
            Apply draft
          </button>
          <button
            type="button"
            disabled={!changed}
            onClick={() => {
              setDraft(applied);
              setNotice("Unapplied changes discarded.");
            }}
          >
            Discard changes
          </button>
          <button
            type="button"
            disabled={!differsFromOriginal && !comparing}
            aria-pressed={comparing}
            onClick={() => setComparing((value) => !value)}
          >
            {comparing ? "Hide comparison" : "Compare versions"}
          </button>
        </div>
        <p role="status" aria-live="polite">
          {!validated
            ? "Check required text and date ranges before applying."
            : notice ||
              (changed
                ? "Draft changes — apply to keep them in this tab."
                : "Draft — changes stay in this tab.")}
        </p>
      </footer>
    </section>
  );
}
