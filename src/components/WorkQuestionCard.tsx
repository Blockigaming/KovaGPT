import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
export function WorkQuestionCard({
  question,
  disabled,
  onAnswer,
}: {
  question: { id: string; text: string; options?: string[] };
  disabled: boolean;
  onAnswer: (text: string) => void;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const [other, setOther] = useState("");
  const name = useId();
  const answer = choice === null ? other : (question.options?.[Number(choice)] ?? "");
  return (
    <form
      className="overflow-hidden rounded-3xl border bg-muted/40"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && answer.trim()) onAnswer(answer.trim());
      }}
    >
      <fieldset disabled={disabled}>
        <legend className="px-5 pt-5 text-base font-medium whitespace-pre-wrap">
          {question.text}
        </legend>
        {question.options?.map((option, index) => (
          <label
            key={index}
            className={`flex cursor-pointer items-center gap-3 border-b px-5 py-4 text-sm ${choice === String(index) ? "bg-background" : "hover:bg-muted"}`}
          >
            <input
              className="size-4 accent-current"
              type="radio"
              name={name}
              value={index}
              checked={choice === String(index)}
              onChange={() => {
                setChoice(String(index));
                setOther("");
              }}
            />
            <span>{option}</span>
          </label>
        ))}
        <label className="block px-5 pt-4 text-sm">
          {question.options ? "Or write your own answer" : "Your answer"}
          <Textarea
            className="mt-2"
            value={other}
            maxLength={4000}
            onChange={(event) => {
              setChoice(null);
              setOther(event.target.value);
            }}
          />
        </label>
        <div className="flex justify-end p-4">
          <Button className="rounded-full" type="submit" disabled={disabled || !answer.trim()}>
            Submit
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
