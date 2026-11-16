import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { MemoryGameBlock } from "@/lib/interactive-ui.mjs";

function shuffledCards(pairs: MemoryGameBlock["pairs"]) {
  const cards = pairs.flatMap(({ first, second }, pair) => [
    { pair, label: first },
    { pair, label: second },
  ]);
  for (let i = cards.length - 1; i > 0; i--) {
    const position = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[position]] = [cards[position], cards[i]];
  }
  return cards;
}

export function ResponseMemoryGame({ block }: { block: MemoryGameBlock }) {
  const id = useId();
  const [cards, setCards] = useState<ReturnType<typeof shuffledCards>>([]);
  const [open, setOpen] = useState<number[]>([]);
  const [matched, setMatched] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);

  function start() {
    setCards(shuffledCards(block.pairs));
    setOpen([]);
    setMatched([]);
    setMoves(0);
  }

  function reveal(index: number) {
    if (matched.includes(cards[index].pair) || open.includes(index) || open.length === 2) return;
    if (open.length === 0) {
      setOpen([index]);
      return;
    }
    setMoves(moves + 1);
    if (cards[open[0]].pair === cards[index].pair) {
      setMatched([...matched, cards[index].pair]);
      setOpen([]);
    } else setOpen([...open, index]);
  }

  return (
    <section
      aria-labelledby={id}
      className="my-3 min-w-0 rounded-2xl border border-border bg-card p-4 text-card-foreground sm:p-5"
    >
      <h3 id={id} className="font-semibold">
        {block.title}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {block.description || "Turn over two cards to find a pair."}
      </p>
      {cards.length ? (
        <>
          <p role="status" className="mt-3 text-sm">
            {matched.length === block.pairs.length
              ? "All pairs matched."
              : open.length === 2
                ? "Those cards do not match."
                : `${matched.length} of ${block.pairs.length} pairs matched.`}{" "}
            {moves} turns.
          </p>
          <div
            className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"
            role="group"
            aria-label="Cards"
          >
            {cards.map(({ pair, label }, index) => {
              const found = matched.includes(pair);
              const showing = found || open.includes(index);
              return (
                <Button
                  key={index}
                  type="button"
                  variant={showing ? "secondary" : "outline"}
                  className="min-h-14 min-w-0 whitespace-normal break-words px-2"
                  aria-label={
                    showing
                      ? `Card ${index + 1}: ${label}${found ? ", matched" : ""}`
                      : `Turn over card ${index + 1}`
                  }
                  aria-disabled={showing || open.length === 2 ? true : undefined}
                  onClick={() => reveal(index)}
                >
                  {showing ? label : `Card ${index + 1}`}
                </Button>
              );
            })}
          </div>
          {open.length === 2 && (
            <Button type="button" className="mt-3 min-h-11" onClick={() => setOpen([])}>
              Turn cards back over
            </Button>
          )}
        </>
      ) : null}
      <Button
        type="button"
        variant={cards.length ? "ghost" : "default"}
        className="mt-3 min-h-11"
        onClick={start}
      >
        {cards.length ? "Shuffle and restart" : "Start game"}
      </Button>
    </section>
  );
}
