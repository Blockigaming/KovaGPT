import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { QuizCard, StudyBlock } from "@/lib/interactive-ui.mjs";

function matchesAnswer(question: QuizCard, entry: string, selected: string[]) {
  switch (question.kind) {
    case "choice":
      return entry === question.answer;
    case "multiple":
      return (
        selected.length === question.answer.length &&
        question.answer.every((answer) => selected.includes(answer))
      );
    case "ordering":
    case "matching":
      return (
        selected.length === question.answer.length &&
        question.answer.every((answer, index) => selected[index] === answer)
      );
    case "number":
      return entry.trim() !== "" && Math.abs(Number(entry) - question.answer) <= question.tolerance;
    case "short": {
      const normalize = (text: string) =>
        text.trim().normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
      return question.answer.some((answer) => normalize(answer) === normalize(entry));
    }
  }
}

export function StudyCards({ block }: { block: StudyBlock }) {
  const id = useId();
  const seconds = block.type === "quiz" ? block.secondsPerQuestion : undefined;
  const [clockMode, setClockMode] = useState<"timed" | "untimed">();
  const [deadline, setDeadline] = useState<number>();
  const [remaining, setRemaining] = useState(seconds);
  const [index, setIndex] = useState(0);
  const [order, setOrder] = useState(() => block.cards.map((_, position) => position));
  const [entry, setEntry] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [showHint, setShowHint] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [missed, setMissed] = useState<number[]>([]);
  const done = index >= order.length;
  const flashcards = block.type === "flashcards";
  const card = block.cards[order[index]];
  const question = block.type === "quiz" ? block.cards[order[index]] : undefined;
  const timedOut = clockMode === "timed" && remaining === 0;
  const correct = question && !timedOut ? matchesAnswer(question, entry, selected) : false;
  const showAnswer = revealed || timedOut;

  useEffect(() => {
    if (deadline === undefined || revealed || done) return;
    const tick = () => {
      const next = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(next);
      if (!next) window.clearInterval(interval);
    };
    const interval = window.setInterval(tick, 250);
    tick();
    return () => window.clearInterval(interval);
  }, [deadline, revealed, done]);

  function startClock() {
    if (seconds === undefined) return;
    setRemaining(seconds);
    setDeadline(Date.now() + seconds * 1000);
  }
  const answered =
    question?.kind === "ordering"
      ? selected.length === question.options.length
      : question?.kind === "matching"
        ? question.items.every((_, position) => !!selected[position])
        : question?.kind === "multiple"
          ? selected.length > 0
          : entry.trim() !== "";

  function advance(earned: boolean) {
    if (!earned) setMissed((current) => [...current, order[index]]);
    setScore((total) => total + Number(earned));
    setIndex((current) => current + 1);
    setEntry("");
    setSelected([]);
    setShowHint(false);
    setRevealed(false);
    if (clockMode === "timed" && index + 1 < order.length) startClock();
  }

  function restart(nextOrder: number[]) {
    setOrder(nextOrder);
    setIndex(0);
    setScore(0);
    setMissed([]);
    setRevealed(false);
    if (clockMode === "timed") startClock();
  }

  function shuffle() {
    const shuffled = block.cards.map((_, position) => position);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    restart(shuffled);
  }

  return (
    <section
      aria-labelledby={id}
      data-interactive-type={block.type}
      className="my-3 min-w-0 rounded-2xl border border-border bg-card p-4 text-card-foreground [overflow-wrap:anywhere] sm:p-5"
    >
      <h3 id={id} className="text-base font-semibold">
        {block.title}
      </h3>
      {block.description && (
        <p className="mt-1 text-sm text-muted-foreground">{block.description}</p>
      )}
      {flashcards && block.cards.length > 1 && (
        <Button type="button" variant="ghost" className="mt-2 min-h-11" onClick={shuffle}>
          Shuffle and restart
        </Button>
      )}
      {seconds && !clockMode ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <p className="w-full text-sm">{seconds} seconds per question</p>
          <Button
            type="button"
            className="min-h-11"
            onClick={() => {
              setClockMode("timed");
              startClock();
            }}
          >
            Start timed practice
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => setClockMode("untimed")}
          >
            Practice without timer
          </Button>
        </div>
      ) : done ? (
        <div className="mt-4 grid gap-3">
          <p role="status">
            {score} of {order.length} {flashcards ? "known" : "correct"}
          </p>
          <div className="flex flex-wrap gap-2">
            {block.adaptive && missed.length > 0 && (
              <Button type="button" className="min-h-11" onClick={() => restart(missed)}>
                Review missed {flashcards ? "cards" : "questions"}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => restart(block.cards.map((_, position) => position))}
            >
              Start over
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {flashcards ? "Card" : "Question"} {index + 1} of {order.length}
          </p>
          {clockMode === "timed" && !showAnswer && (
            <p role="timer" className="text-sm tabular-nums">
              {remaining} seconds left
            </p>
          )}
          {question ? (
            <fieldset disabled={showAnswer} className="grid min-w-0 gap-1">
              <legend className="mb-2 font-medium">{question.front}</legend>
              {question.kind === "ordering" ? (
                <div className="grid gap-2">
                  <ol className="list-decimal pl-6" aria-label="Your order">
                    {selected.map((value) => (
                      <li key={value}>
                        {question.options.find((option) => option.value === value)?.label}
                      </li>
                    ))}
                  </ol>
                  <div className="flex flex-wrap gap-2">
                    {question.options
                      .filter(({ value }) => !selected.includes(value))
                      .map(({ value, label }) => (
                        <Button
                          key={value}
                          type="button"
                          variant="outline"
                          className="min-h-11"
                          disabled={showAnswer}
                          onClick={() => setSelected([...selected, value])}
                        >
                          {label}
                        </Button>
                      ))}
                    {selected.length > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={showAnswer}
                        onClick={() => setSelected(selected.slice(0, -1))}
                      >
                        Undo last choice
                      </Button>
                    )}
                  </div>
                </div>
              ) : question.kind === "matching" ? (
                question.items.map((item, position) => (
                  <label key={item.value} className="grid gap-1 text-sm">
                    {item.label}
                    <select
                      className="min-h-11 min-w-0 rounded-lg border border-border bg-background px-2"
                      value={selected[position] ?? ""}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setSelected((current) =>
                          question.items.map((_, i) =>
                            i === position ? value : (current[i] ?? ""),
                          ),
                        );
                      }}
                    >
                      <option value="">Choose an answer</option>
                      {question.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))
              ) : "options" in question ? (
                question.options.map((option) => (
                  <label
                    key={option.value}
                    className="flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-accent"
                  >
                    <input
                      type={question.kind === "multiple" ? "checkbox" : "radio"}
                      className="shrink-0 accent-primary"
                      name={id}
                      value={option.value}
                      checked={
                        question.kind === "multiple"
                          ? selected.includes(option.value)
                          : entry === option.value
                      }
                      onChange={(event) => {
                        if (question.kind === "choice") setEntry(option.value);
                        else {
                          const checked = event.currentTarget.checked;
                          setSelected((current) =>
                            checked
                              ? [...current, option.value]
                              : current.filter((value) => value !== option.value),
                          );
                        }
                      }}
                    />
                    {option.label}
                  </label>
                ))
              ) : (
                <input
                  aria-label="Your answer"
                  type={question.kind === "number" ? "number" : "text"}
                  step={question.kind === "number" ? "any" : undefined}
                  maxLength={question.kind === "short" ? 200 : undefined}
                  className="min-h-11 min-w-0 rounded-lg border border-border bg-background px-3"
                  value={entry}
                  onChange={(event) => setEntry(event.currentTarget.value)}
                />
              )}
            </fieldset>
          ) : (
            <p className="py-3 text-lg font-medium">{card.front}</p>
          )}
          {showHint && question?.hint && <p role="status">{question.hint}</p>}
          {showAnswer && (
            <div role="status" className="rounded-lg bg-muted p-3">
              {question && (
                <p className="font-medium">
                  {timedOut ? "Time is up" : correct ? "Correct" : "Incorrect"}
                </p>
              )}
              <p>{card.back}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {!showAnswer && (
              <Button
                type="button"
                className="min-h-11"
                disabled={!!question && !answered}
                onClick={() => {
                  if (deadline === undefined || Date.now() < deadline) setRevealed(true);
                  else setRemaining(0);
                }}
              >
                {flashcards ? "Reveal answer" : "Check answer"}
              </Button>
            )}
            {!showAnswer && !showHint && question?.hint && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => setShowHint(true)}
              >
                Show hint
              </Button>
            )}
            {showAnswer &&
              (question ? (
                <Button type="button" className="min-h-11" onClick={() => advance(correct)}>
                  {index + 1 === order.length ? "See score" : "Next question"}
                </Button>
              ) : (
                <>
                  <Button type="button" className="min-h-11" onClick={() => advance(true)}>
                    I knew it
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => advance(false)}
                  >
                    Needs practice
                  </Button>
                </>
              ))}
          </div>
        </div>
      )}
    </section>
  );
}
