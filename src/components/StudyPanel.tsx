import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import { fetchForPrincipal } from "@/lib/chat-summary-snapshot.mjs";
import { chatResponseError, consumeChatSse } from "@/lib/chat-sse-client.mjs";
import {
  StudyState,
  parseStudyDeck,
  studyPrompt,
  nextStudyCard,
  recordStudyAttempt,
  studySummary,
  type PracticeState,
  type Attempt,
} from "@/lib/study-policy.mjs";
import { listStudySets, getStudySet, saveStudySet, type StudyRecord } from "@/lib/study.functions";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
} from "@/lib/principal-browser-storage.mjs";

type Props = { ownerId: string | null; temporary?: boolean; source?: string };
export function StudyPanel(props: Props) {
  const [epoch, setEpoch] = useState(0);
  const sourceOwner = useRef(props.ownerId);
  useEffect(() => {
    const reset = (event: Event) => {
      if (isPrincipalBrowserStorageClearedEvent(event, props.ownerId))
        setEpoch((value) => value + 1);
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
  }, [props.ownerId]);
  return (
    <StudySession
      key={`${props.ownerId}:${props.temporary}:${epoch}`}
      {...props}
      source={epoch === 0 && sourceOwner.current === props.ownerId ? props.source : ""}
    />
  );
}
function StudySession({ ownerId, temporary = false, source = "" }: Props) {
  const [goal, setGoal] = useState("");
  const [material, setMaterial] = useState(source.length <= 20000 ? source : "");
  const [depth, setDepth] = useState("standard");
  const [state, setState] = useState<PracticeState | null>(null);
  const [cardIndex, setCardIndex] = useState(0);
  const [hint, setHint] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [mode, setMode] = useState<"quiz" | "flashcard">("quiz");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [dirty, setDirty] = useState(false);
  const [records, setRecords] = useState<StudyRecord[]>([]);
  const [record, setRecord] = useState<{
    id: string;
    revision: number;
    creation_token: string;
  } | null>(null);
  const [pendingSave, setPendingSave] = useState<null | {
    id: string;
    expectedRevision: number;
    mutationId: string;
    creationToken: string;
    body: PracticeState | null;
    remove: boolean;
  }>(null);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const operation = useRef(0);
  const stateRevision = useRef(0);
  const sectionRef = useRef<HTMLElement | null>(null);
  const confirmInvoker = useRef<{ element: HTMLElement | null; url: string }>({
    element: null,
    url: "",
  });
  const [confirmation, setConfirmation] = useState<null | {
    action: "generate" | "open" | "import" | "delete" | "reload";
    row?: StudyRecord;
    file?: File;
    revision: number;
    operation: number;
    recordId: string | null;
    pendingMutationId: string | null;
  }>(null);
  function requestConfirmation(
    action: NonNullable<typeof confirmation>["action"],
    details: { row?: StudyRecord; file?: File } = {},
  ) {
    confirmInvoker.current = {
      element: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      url: window.location.href,
    };
    setConfirmation({
      action,
      ...details,
      revision: stateRevision.current,
      operation: operation.current,
      recordId: record?.id ?? null,
      pendingMutationId: pendingSave?.mutationId ?? null,
    });
  }
  const listFn = useServerFn(listStudySets),
    getFn = useServerFn(getStudySet),
    saveFn = useServerFn(saveStudySet);
  useEffect(() => {
    alive.current = true;
    const operations = operation;
    const requests = controller;
    return () => {
      alive.current = false;
      operations.current++;
      requests.current?.abort();
    };
  }, []);
  const resetCard = (index: number) => {
    setCardIndex(index);
    setHint(false);
    setRevealed(false);
    setAnswered(false);
  };
  const adopt = (
    next: PracticeState,
    row: { id: string; revision: number; creation_token: string } | null,
  ) => {
    stateRevision.current++;
    setState(next);
    setRecord(row);
    setPendingSave(null);
    resetCard(nextStudyCard(next));
    setDirty(false);
    setError("");
    setStatus(
      row
        ? "Loaded saved practice."
        : "Practice is ready. Save it when you want to keep your progress.",
    );
  };
  async function generate(confirmed = false) {
    if (busy || pendingSave) return;
    if (dirty && !confirmed) {
      requestConfirmation("generate");
      return;
    }
    const token = ++operation.current;
    controller.current?.abort();
    const own = new AbortController();
    controller.current = own;
    const signal = AbortSignal.any([own.signal, AbortSignal.timeout(160000)]);
    setBusy(true);
    setError("");
    setStatus("Creating practice questions…");
    try {
      const prompt = studyPrompt({ goal, depth, source: material });
      const response = await fetchForPrincipal(ownerId, "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        signal,
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
          mode: "instant",
          clientTool: "study",
          temporary: true,
          temporaryContext: "clean",
        }),
      });
      if (!response.ok || !response.body)
        throw await chatResponseError(response, "Practice could not be generated.");
      let text = "";
      await consumeChatSse(response.body, {
        signal,
        maxBufferChars: 110000,
        onEvent(event) {
          const choices = event.choices;
          const delta = Array.isArray(choices) ? choices[0]?.delta?.content : undefined;
          if (typeof delta === "string") {
            text += delta;
            if (text.length > 100000)
              throw new Error("The practice response was too large. Try again.");
          }
        },
      });
      const deck = parseStudyDeck(text);
      if (alive.current && token === operation.current) {
        adopt({ version: 1, deck, attempts: [] }, null);
        setDirty(true);
      }
    } catch (problem) {
      if (alive.current && token === operation.current) {
        setError(
          signal.aborted
            ? "Practice generation stopped."
            : problem instanceof Error
              ? problem.message
              : "Practice could not be generated.",
        );
        setStatus("");
      }
    } finally {
      if (alive.current && token === operation.current) setBusy(false);
    }
  }
  function answer(value: Pick<Attempt, "answer" | "recalled">) {
    if (!state || answered || pendingSave) return;
    stateRevision.current++;
    setState(recordStudyAttempt(state, { card: cardIndex, ...value, hint }));
    setAnswered(true);
    setRevealed(true);
    setDirty(true);
    setStatus("Progress is unsaved.");
  }
  async function refresh() {
    if (!ownerId || temporary || busy) return;
    const token = ++operation.current;
    setBusy(true);
    setError("");
    try {
      const rows = await listFn({ data: { expectedUserId: ownerId } });
      if (alive.current && token === operation.current) setRecords(rows);
    } catch (problem) {
      if (alive.current && token === operation.current)
        setError(
          problem instanceof Error ? problem.message : "Saved practice could not be loaded.",
        );
    } finally {
      if (alive.current && token === operation.current) setBusy(false);
    }
  }
  async function open(row: StudyRecord, confirmed = false) {
    if (!ownerId || busy || pendingSave) return;
    if (dirty && !confirmed) {
      requestConfirmation("open", { row });
      return;
    }
    const token = ++operation.current;
    setBusy(true);
    try {
      const current = await getFn({ data: { expectedUserId: ownerId, id: row.id } });
      if (alive.current && token === operation.current)
        adopt(StudyState.parse(current.body), current);
    } catch (problem) {
      if (alive.current && token === operation.current)
        setError(problem instanceof Error ? problem.message : "Practice could not be loaded.");
    } finally {
      if (alive.current && token === operation.current) setBusy(false);
    }
  }
  async function save(remove = false, confirmed = false) {
    if (!ownerId || temporary || busy || !state) return;
    if (remove && !pendingSave && !confirmed) {
      requestConfirmation("delete");
      return;
    }
    const attempt = pendingSave ?? {
      id: record?.id ?? crypto.randomUUID(),
      expectedRevision: record?.revision ?? 0,
      mutationId: crypto.randomUUID(),
      creationToken: record?.creation_token ?? new Date().toISOString(),
      body: remove ? null : state,
      remove,
    };
    setPendingSave(attempt);
    const revision = stateRevision.current;
    const token = ++operation.current;
    setBusy(true);
    setError("");
    try {
      const result = await saveFn({
        data: { ...attempt, expectedUserId: ownerId, temporary: false },
      });
      if (alive.current && token === operation.current) {
        if ("creationExpired" in result) {
          setPendingSave(null);
          setRecord(null);
          setDirty(true);
          setStatus(
            "This save attempt expired. Your practice is still here; choose Save progress to start a new save.",
          );
          return;
        }
        setPendingSave(null);
        if (result.deleted_at) {
          setState(null);
          setRecord(null);
          setDirty(false);
          setRecords((rows) => rows.filter((row) => row.id !== result.id));
          setStatus("Saved practice deleted.");
        } else {
          setRecord(result);
          if (revision === stateRevision.current) setDirty(false);
          setStatus("Practice and progress saved to your account.");
        }
      }
    } catch (problem) {
      if (alive.current && token === operation.current)
        setError(
          problem instanceof Error ? problem.message : "Save was not confirmed. Retry this save.",
        );
    } finally {
      if (alive.current && token === operation.current) setBusy(false);
    }
  }
  async function reloadPending(confirmed = false) {
    if (!ownerId || !pendingSave || busy) return;
    if (!confirmed) {
      requestConfirmation("reload");
      return;
    }
    const token = ++operation.current;
    setBusy(true);
    setError("");
    try {
      const current = await getFn({ data: { expectedUserId: ownerId, id: pendingSave.id } });
      if (alive.current && token === operation.current)
        adopt(StudyState.parse(current.body), current);
    } catch (problem) {
      if (alive.current && token === operation.current)
        setError(
          problem instanceof Error
            ? problem.message
            : "The saved version could not be loaded. Retry the unconfirmed save.",
        );
    } finally {
      if (alive.current && token === operation.current) setBusy(false);
    }
  }
  function importPractice(file: File, confirmed = false) {
    if (busy || pendingSave) return;
    if (dirty && !confirmed) {
      requestConfirmation("import", { file });
      return;
    }
    if (file.size > 180000) {
      setError("This practice export is too large.");
      return;
    }
    const token = ++operation.current;
    const revision = stateRevision.current;
    setBusy(true);
    setError("");
    void file
      .text()
      .then((text) => {
        const value = StudyState.parse(JSON.parse(text));
        if (alive.current && token === operation.current && revision === stateRevision.current) {
          adopt(value, null);
          setDirty(true);
        }
      })
      .catch(() => {
        if (alive.current && token === operation.current)
          setError("Choose a valid KovaGPT practice export.");
      })
      .finally(() => {
        if (alive.current && token === operation.current) setBusy(false);
      });
  }
  function confirmAction() {
    if (!confirmation) return;
    const requested = confirmation;
    setConfirmation(null);
    if (
      !alive.current ||
      busy ||
      requested.revision !== stateRevision.current ||
      requested.operation !== operation.current ||
      requested.recordId !== (record?.id ?? null) ||
      requested.pendingMutationId !== (pendingSave?.mutationId ?? null)
    ) {
      setError("Practice changed. Review it before trying this action again.");
      return;
    }
    if (requested.action === "generate") void generate(true);
    else if (requested.action === "open" && requested.row) void open(requested.row, true);
    else if (requested.action === "import" && requested.file) importPractice(requested.file, true);
    else if (requested.action === "delete") void save(true, true);
    else if (requested.action === "reload") void reloadPending(true);
  }
  const summary = state ? studySummary(state) : null,
    card = state?.deck.cards[cardIndex];
  const buttonClass = "border text-sm";
  return (
    <section
      data-ui-reference="chatgpt.study.practice"
      ref={sectionRef}
      tabIndex={-1}
      className={"kova-tool-panel " + "space-y-5"}
      aria-label="Study practice"
    >
      <div>
        <h2 className="text-xl font-semibold">Practice and flashcards</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Set a goal, explore hints, then check your reasoning. Questions are AI-generated; compare
          explanations with your course material.
        </p>
      </div>
      <div className="grid gap-3">
        <label className="grid gap-1 text-sm">
          Learning goal
          <Input
            maxLength={500}
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            className="  border bg-background "
            placeholder="What do you want to understand?"
          />
        </label>
        <label className="grid gap-1 text-sm">
          Depth
          <Select value={depth} onValueChange={setDepth}>
            <SelectTrigger aria-label="Depth" className="">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="foundational">Foundational</SelectItem>
              <SelectItem value="standard">Standard</SelectItem>
              <SelectItem value="advanced">Advanced</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-1 text-sm">
          Notes or an explanation to practice
          <Textarea
            aria-label="Notes or an explanation to practice"
            rows={5}
            maxLength={20000}
            value={material}
            onChange={(event) => setMaterial(event.target.value)}
            className="w-full  border bg-background "
            placeholder="Paste your notes, or use a chat explanation of your file or image."
          />
        </label>
        {source.length > 20000 && (
          <p className="text-sm">
            The chat response is too long to include automatically. Paste the section you want to
            practice.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || !goal.trim() || Boolean(pendingSave)}
            onClick={() => void generate()}
          >
            Create practice
          </Button>
          {busy && controller.current && (
            <Button variant="outline" onClick={() => controller.current?.abort()}>
              Stop generation
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="text-sm">
          {status}
        </p>
      )}
      {state && card && summary && (
        <div className="space-y-4 rounded-xl border p-4">
          <h3 className="font-semibold">{state.deck.title}</h3>
          <p className="text-sm">{state.deck.goal}</p>
          <p className="text-sm text-muted-foreground">
            {summary.practiced} of {state.deck.cards.length} cards practiced · {summary.confident}{" "}
            confident without a hint · {summary.attempts === 1000 ? "Last 1,000" : summary.attempts}{" "}
            attempts{dirty ? " · Unsaved" : ""}
          </p>
          <label className="flex flex-wrap items-center gap-2 text-sm">
            Practice style
            <Select
              disabled={answered || revealed}
              value={mode}
              onValueChange={(value) => setMode(value as "quiz" | "flashcard")}
            >
              <SelectTrigger aria-label="Practice style" className=" w-auto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="quiz">Knowledge check</SelectItem>
                <SelectItem value="flashcard">Flashcards</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <fieldset disabled={Boolean(pendingSave) || busy} className="space-y-3">
            <legend className="font-medium">{card.question}</legend>
            {!answered && mode === "quiz" && (
              <div className="grid gap-2">
                {card.choices.map((choice, index) => (
                  <Button
                    variant="ghost"
                    data-ui-reference="chatgpt.study.answer-option"
                    data-kova-button-shape="preserve"
                    type="button"
                    key={index}
                    className={
                      buttonClass +
                      " kova-tool-answer-option h-auto whitespace-normal rounded-xl text-left"
                    }
                    onClick={() => answer({ answer: index, recalled: null })}
                  >
                    {choice}
                  </Button>
                ))}
              </div>
            )}
            {!revealed && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  type="button"
                  className={buttonClass}
                  onClick={() => setHint(true)}
                >
                  Show a hint
                </Button>
                {mode === "flashcard" && (
                  <Button
                    variant="ghost"
                    type="button"
                    className={buttonClass}
                    onClick={() => setRevealed(true)}
                  >
                    Reveal answer
                  </Button>
                )}
              </div>
            )}
            {hint && !revealed && <p className="rounded-lg bg-muted p-3 text-sm">{card.hint}</p>}
            {revealed && (
              <div className="space-y-2" aria-live="polite">
                <p>
                  <strong>Answer:</strong> {card.choices[card.answer]}
                </p>
                <p className="whitespace-pre-wrap text-sm">{card.explanation}</p>
                {answered && mode === "quiz" && (
                  <p className="text-sm">
                    {state.attempts.at(-1)?.answer === card.answer
                      ? "Correct."
                      : "Review the explanation, then try this concept again."}
                  </p>
                )}
              </div>
            )}
            {revealed && !answered && mode === "flashcard" && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  type="button"
                  className={buttonClass}
                  onClick={() => answer({ answer: null, recalled: false })}
                >
                  Practice again
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  className={buttonClass}
                  onClick={() => answer({ answer: null, recalled: true })}
                >
                  I recalled it
                </Button>
              </div>
            )}
            {answered && (
              <Button
                variant="ghost"
                type="button"
                className={buttonClass}
                onClick={() => resetCard(nextStudyCard(state, cardIndex))}
              >
                Next card
              </Button>
            )}
          </fieldset>
          <p className="text-xs text-muted-foreground">
            New cards come first, followed by missed or hinted cards. Flashcard confidence comes
            from your own rating.
          </p>
          <div className="flex flex-wrap gap-2">
            {ownerId && !temporary && (
              <>
                <Button disabled={busy} onClick={() => void save()}>
                  {pendingSave ? "Retry unconfirmed save" : "Save progress"}
                </Button>
                {record && !pendingSave && (
                  <Button variant="outline" disabled={busy} onClick={() => void save(true)}>
                    Delete saved set
                  </Button>
                )}
              </>
            )}
            <Button
              variant="outline"
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = "kovagpt-practice.json";
                link.click();
                URL.revokeObjectURL(url);
              }}
            >
              Export practice
            </Button>
          </div>
          {pendingSave && (
            <Button variant="outline" disabled={busy} onClick={() => void reloadPending()}>
              Reload saved version
            </Button>
          )}
          {pendingSave && (
            <p className="text-sm">
              A save is unconfirmed. Retry it before changing this set. You can export your current
              practice.
            </p>
          )}
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        {temporary
          ? "Temporary Chat practice stays in this open view. Account saving is disabled."
          : ownerId
            ? "Practice is kept only when you choose Save progress."
            : "Sign in to save practice across devices. Unsaved practice lasts only in this view."}
      </p>
      {ownerId && !temporary && (
        <div className="space-y-2">
          <Button variant="outline" disabled={busy} onClick={() => void refresh()}>
            Load saved practice
          </Button>
          <ul className="space-y-2">
            {records.map((row) => (
              <li key={row.id}>
                <Button
                  variant="ghost"
                  data-ui-reference="chatgpt.study.saved-practice-row"
                  data-kova-button-shape="preserve"
                  type="button"
                  disabled={busy || Boolean(pendingSave)}
                  className={
                    buttonClass +
                    " kova-tool-row-action h-auto w-full whitespace-normal rounded-xl text-left"
                  }
                  onClick={() => void open(row)}
                >
                  {row.title ?? "Saved practice"}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <label className="grid gap-1 text-sm">
        Import an exported practice set
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy || Boolean(pendingSave)}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) importPractice(file);
          }}
        />
      </label>
      <ConfirmActionDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
        title={
          confirmation?.action === "delete"
            ? "Delete saved practice?"
            : confirmation?.action === "reload"
              ? "Reload saved practice?"
              : "Replace unsaved practice?"
        }
        description={
          confirmation?.action === "delete"
            ? "Delete this saved practice and its progress?"
            : confirmation?.action === "reload"
              ? "Discard this local practice and reload the saved version? Export first to keep your local answers."
              : "Replace this unsaved practice? Export or save it first if you want to keep it."
        }
        confirmLabel={
          confirmation?.action === "delete"
            ? "Delete practice"
            : confirmation?.action === "reload"
              ? "Reload saved version"
              : "Replace practice"
        }
        destructive={confirmation?.action === "delete"}
        disabled={busy}
        onConfirm={confirmAction}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const invoker = confirmInvoker.current;
          const target =
            invoker.element?.isConnected && !invoker.element.matches(":disabled")
              ? invoker.element
              : sectionRef.current;
          restoreDialogFocus(target, invoker.url);
        }}
      />
    </section>
  );
}
