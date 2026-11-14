import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { StudyBlock } from "@/lib/interactive-ui.mjs";

export function StudyCards({ block }: { block: StudyBlock }) {
  const id = useId();
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState("");
  const [showHint, setShowHint] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const done = index === block.cards.length;
  const flashcards = block.type === "flashcards";
  const card = block.cards[index];
  const question = block.type === "quiz" ? block.cards[index] : undefined;

  function advance(earned: boolean) {
    setScore((total) => total + Number(earned));
    setIndex((current) => current + 1);
    setChoice("");
    setShowHint(false);
    setRevealed(false);
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
      {done ? (
        <div className="mt-4 grid gap-3">
          <p role="status">
            {score} of {block.cards.length} {flashcards ? "known" : "correct"}
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 justify-self-start"
            onClick={() => {
              setScore(0);
              setIndex(0);
            }}
          >
            Start over
          </Button>
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {flashcards ? "Card" : "Question"} {index + 1} of {block.cards.length}
          </p>
          {question ? (
            <fieldset disabled={revealed} className="grid min-w-0 gap-1">
              <legend className="mb-2 font-medium">{question.front}</legend>
              {question.options.map((option) => (
                <label
                  key={option.value}
                  className="flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-accent"
                >
                  <input
                    type="radio"
                    className="shrink-0 accent-primary"
                    name={id}
                    value={option.value}
                    checked={choice === option.value}
                    onChange={() => setChoice(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="py-3 text-lg font-medium">{card.front}</p>
          )}
          {showHint && question?.hint && <p role="status">{question.hint}</p>}
          {revealed && (
            <div role="status" className="rounded-lg bg-muted p-3">
              {question && (
                <p className="font-medium">
                  {choice === question.answer ? "Correct" : "Incorrect"}
                </p>
              )}
              <p>{card.back}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {!revealed && (
              <Button
                type="button"
                className="min-h-11"
                disabled={!!question && !choice}
                onClick={() => setRevealed(true)}
              >
                {flashcards ? "Reveal answer" : "Check answer"}
              </Button>
            )}
            {!revealed && !showHint && question?.hint && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => setShowHint(true)}
              >
                Show hint
              </Button>
            )}
            {revealed &&
              (question ? (
                <Button
                  type="button"
                  className="min-h-11"
                  onClick={() => advance(choice === question.answer)}
                >
                  {index + 1 === block.cards.length ? "See score" : "Next question"}
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
