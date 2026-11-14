import { useEffect, useId, useMemo, useRef, useState } from "react";
import { StudyCards } from "./StudyCards";
import { ResponseSpeech } from "./ResponseSpeech";
import { ResponseMemoryGame } from "./ResponseMemoryGame";
import { ResponseFiles } from "./ResponseFiles";
import { ResponsePattern } from "./ResponsePattern";
import { ResponseDiagram } from "./ResponseDiagram";
import { ResponseSimulation } from "./ResponseSimulation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatSubmission,
  INTELLIGENT_INTERFACE_NAME,
  initialFormValues,
  validateFormValues,
  type FormValue,
  type FormValues,
  type InteractiveBlock as Block,
  type InteractiveField,
  type InteractiveForm,
  type InteractiveSubmission,
  type InteractiveTable,
} from "@/lib/interactive-ui.mjs";

type Stored = { submission?: InteractiveSubmission; draft?: InteractiveSubmission };

function readStored(key: string | null): Stored {
  if (!key || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Stored) : {};
  } catch {
    return {};
  }
}
function writeStored(key: string | null, value: Stored) {
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or disabled: state stays in memory for this tab.
  }
}

function preserveActionFocus(event: React.PointerEvent<HTMLButtonElement>) {
  // Prevent mouse focus stealing without cancelling touch-generated clicks in Safari.
  if (event.button === 0 && event.pointerType === "mouse") event.preventDefault();
}

export type InteractiveBlockProps = {
  ownerId?: string;
  block: Block;
  /** Stable per-response key; state and submissions persist under it. */
  storageKey: string | null;
  /** Sends the submission as the user's next conversation message. Absent = read-only. */
  onSubmit?: (message: string) => boolean | void;
  disabledReason?: string;
};

/** Safe native renderer for validated kova-interactive blocks. No HTML, no scripts. */
export function InteractiveBlock({
  block,
  storageKey,
  onSubmit,
  disabledReason,
  ownerId,
}: InteractiveBlockProps) {
  const [stored, setStored] = useState<Stored>({});
  const [hydrated, setHydrated] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const submittedRef = useRef(false);
  useEffect(() => {
    const restored = readStored(storageKey);
    submittedRef.current = !!restored.submission;
    setStored(restored);
    setHydrated(true);
  }, [storageKey]);

  const submitted = stored.submission;
  const locked = !!submitted || !onSubmit;
  const persist = (next: Stored) => {
    setStored(next);
    writeStored(storageKey, next);
  };
  const submit = (submission: InteractiveSubmission) => {
    if (!onSubmit || locked || submittedRef.current) return;
    submittedRef.current = true;
    try {
      if (onSubmit(formatSubmission(block, submission)) === false) {
        submittedRef.current = false;
        setSubmitError(true);
        return;
      }
    } catch (error) {
      submittedRef.current = false;
      throw error;
    }
    setSubmitError(false);
    persist({ submission });
  };
  const saveDraft = (draft: InteractiveSubmission) => {
    if (submittedRef.current) return;
    // FormBody already owns the live field state. Persist the draft directly
    // without forcing the parent to rerender on every pointer/keyboard event.
    // Parent rerenders during a Radix click can reinitialize its selection.
    writeStored(storageKey, { draft });
    if (submitError) setSubmitError(false);
  };
  const headingId = useId();

  if (block.type === "quiz" || block.type === "flashcards")
    return <StudyCards key={JSON.stringify(block)} block={block} />;

  if (block.type === "simulation")
    return <ResponseSimulation key={JSON.stringify(block)} block={block} />;
  if (block.type === "memory-game")
    return <ResponseMemoryGame key={JSON.stringify(block)} block={block} />;
  if (block.type === "speech")
    return (
      <ResponseSpeech key={JSON.stringify([ownerId, block])} block={block} ownerId={ownerId} />
    );
  if (block.type === "files") return <ResponseFiles key={JSON.stringify(block)} block={block} />;
  if (block.type === "diagram") return <ResponseDiagram block={block} />;
  if (block.type === "pattern")
    return <ResponsePattern key={JSON.stringify(block)} block={block} />;

  return (
    <section
      className="kova-interactive my-3 min-w-0 max-w-full rounded-2xl border border-border bg-card p-4 text-card-foreground [overflow-wrap:anywhere] sm:p-5"
      aria-labelledby={headingId}
      data-interactive-type={block.type}
      data-interactive-state={submitted ? "submitted" : locked ? "readonly" : "open"}
    >
      <header className="mb-3">
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          {INTELLIGENT_INTERFACE_NAME}
        </p>
        <h3 id={headingId} className="text-base font-semibold leading-snug">
          {block.title}
        </h3>
        {block.description && (
          <p className="mt-1 text-sm text-muted-foreground">{block.description}</p>
        )}
      </header>
      {hydrated &&
        (block.type === "form" ? (
          <FormBody
            block={block}
            locked={locked}
            initial={submitted?.values ?? stored.draft?.values}
            submittedAction={submitted?.action}
            onDraft={(values) => saveDraft({ values })}
            onSubmit={submit}
          />
        ) : (
          <TableBody
            block={block}
            locked={locked}
            initial={submitted?.selected ?? stored.draft?.selected}
            onDraft={(selected) => saveDraft({ selected })}
            onSubmit={submit}
          />
        ))}
      {submitError && !submitted && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          Your response was not sent. Check the chat status, then try again.
        </p>
      )}
      {submitted ? (
        <p role="status" className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Check className="h-4 w-4" aria-hidden="true" /> Sent
        </p>
      ) : !onSubmit && hydrated ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {disabledReason ?? "This form is only active on the latest reply."}
        </p>
      ) : null}
    </section>
  );
}

function FormBody({
  block,
  locked,
  initial,
  submittedAction,
  onDraft,
  onSubmit,
}: {
  block: InteractiveForm;
  locked: boolean;
  initial?: FormValues;
  submittedAction?: string;
  onDraft: (values: FormValues) => void;
  onSubmit: (s: InteractiveSubmission) => void;
}) {
  const formId = useId();
  const [values, setValues] = useState<FormValues>(() => ({
    ...initialFormValues(block),
    ...(initial ?? {}),
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Keep rapid successive field edits in event order, even before React commits
  // a render (notably date + radio changes in narrow Firefox layouts).
  const valuesRef = useRef(values);
  const set = (id: string, value: FormValue) => {
    // Radix may invoke onClick and onValueChange for the same selection.
    // Ignore duplicate events and merge updates functionally so an earlier
    // low-priority field update cannot revert a later radio selection.
    if (Object.is(valuesRef.current[id], value)) return;
    const next = { ...valuesRef.current, [id]: value };
    valuesRef.current = next;
    setValues((current) => ({ ...current, [id]: value }));
    if (errors[id]) setErrors(({ [id]: _drop, ...rest }) => rest);
    onDraft(next);
  };
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (locked) return;
    const found = validateFormValues(block, valuesRef.current);
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) {
      document.getElementById(`kova-field-${formId}-${first}`)?.focus();
      return;
    }
    const clean: FormValues = {};
    for (const f of block.fields)
      clean[f.id] =
        f.kind === "number" && valuesRef.current[f.id] !== ""
          ? Number(valuesRef.current[f.id])
          : valuesRef.current[f.id];
    onSubmit({ values: clean });
  };
  const hasFields = block.fields.length > 0;

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-4">
      {block.fields.map((field) => (
        <FieldControl
          key={field.id}
          formId={formId}
          field={field}
          value={values[field.id]}
          error={errors[field.id]}
          disabled={locked}
          onChange={(v) => set(field.id, v)}
        />
      ))}
      <div className="flex flex-wrap gap-2 pt-1">
        {hasFields && (
          <Button
            type="submit"
            onPointerDown={preserveActionFocus}
            disabled={locked}
            className="h-auto min-h-11 max-w-full whitespace-normal sm:min-h-9"
          >
            {block.submitLabel ?? "Submit"}
          </Button>
        )}
        {block.actions.map((action) => (
          <Button
            key={action.id}
            type="button"
            variant={action.style === "primary" ? "default" : "outline"}
            disabled={locked}
            aria-pressed={submittedAction === action.id || undefined}
            className="h-auto min-h-11 max-w-full whitespace-normal sm:min-h-9"
            onPointerDown={preserveActionFocus}
            onClick={() => !locked && onSubmit({ action: action.id, values: valuesRef.current })}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </form>
  );
}

function FieldControl({
  formId,
  field,
  value,
  error,
  disabled,
  onChange,
}: {
  formId: string;
  field: InteractiveField;
  value: FormValue | undefined;
  error?: string;
  disabled: boolean;
  onChange: (v: FormValue) => void;
}) {
  const id = `kova-field-${formId}-${field.id}`;
  const helpId = field.help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;
  const common = {
    id,
    disabled,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    "aria-required": field.required || undefined,
  };
  const label = (
    <>
      {field.label}
      {field.required && (
        <span className="text-muted-foreground" aria-hidden="true">
          {" "}
          *
        </span>
      )}
    </>
  );
  let control: React.ReactNode;
  switch (field.kind) {
    case "textarea":
      control = (
        <Textarea
          {...common}
          value={String(value ?? "")}
          maxLength={4000}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case "text":
    case "search":
    case "number":
    case "date":
    case "time":
    case "color":
      control = (
        <Input
          {...common}
          type={field.kind}
          inputMode={field.kind === "number" ? "decimal" : undefined}
          value={String(value ?? "")}
          min={field.min as string | number | undefined}
          max={field.max as string | number | undefined}
          step={field.step}
          maxLength={field.kind === "text" || field.kind === "search" ? 4000 : undefined}
          placeholder={field.placeholder}
          className="min-h-11 min-w-0 max-w-full sm:min-h-9"
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case "select":
      control = (
        <Select
          value={String(value ?? "") || undefined}
          onValueChange={onChange}
          disabled={disabled}
        >
          <SelectTrigger {...common} className="min-h-11 sm:min-h-9">
            <SelectValue placeholder={field.placeholder ?? "Choose…"} />
          </SelectTrigger>
          <SelectContent>
            {field.options!.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case "slider": {
      const n = typeof value === "number" ? value : Number(value ?? field.min);
      control = (
        <div className="flex items-center gap-3">
          <Slider
            id={id}
            disabled={disabled}
            min={field.min as number}
            max={field.max as number}
            step={field.step ?? 1}
            value={[n]}
            onValueChange={([v]) => onChange(v)}
            thumbProps={{ "aria-labelledby": `${id}-label`, "aria-describedby": describedBy }}
          />
          <output htmlFor={id} className="min-w-12 text-right text-sm tabular-nums">
            {n}
          </output>
        </div>
      );
      break;
    }
    case "toggle":
      return (
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={id} id={`${id}-label`} className="text-sm font-medium">
            {label}
          </Label>
          <Switch {...common} checked={value === true} onCheckedChange={(c) => onChange(c)} />
        </div>
      );
    case "radio":
      return (
        <fieldset aria-describedby={describedBy} aria-invalid={error ? true : undefined}>
          <legend id={`${id}-label`} className="mb-2 text-sm font-medium">
            {label}
          </legend>
          <RadioGroup
            value={String(value ?? "")}
            onValueChange={onChange}
            disabled={disabled}
            aria-labelledby={`${id}-label`}
            aria-required={field.required || undefined}
            className="grid gap-1"
          >
            {field.options!.map((o) => (
              <div
                key={o.value}
                className="flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-accent sm:min-h-9"
              >
                <RadioGroupItem
                  value={o.value}
                  aria-label={o.label}
                  // Capture pointer selection before Radix's focus/roving-tab
                  // handlers. In short Firefox viewports a pointer click can
                  // focus the item without firing a controlled change. The
                  // idempotent form setter handles any subsequent click/change.
                  onPointerDown={(event) => {
                    if (!disabled && event.button === 0) onChange(o.value);
                  }}
                  onClick={() => {
                    if (!disabled) onChange(o.value);
                  }}
                />
                <span className="min-w-0 text-sm">{o.label}</span>
              </div>
            ))}
          </RadioGroup>
          {field.help && (
            <p id={helpId} className="mt-1 text-xs text-muted-foreground">
              {field.help}
            </p>
          )}
          {error && (
            <p id={errorId} className="mt-1 text-xs text-destructive">
              {error}
            </p>
          )}
        </fieldset>
      );
    case "checkbox": {
      const list = Array.isArray(value) ? value : [];
      const updateSelection = (option: string, checked: boolean) => {
        if (checked) {
          if (!list.includes(option)) onChange([...list, option]);
        } else if (list.includes(option)) {
          onChange(list.filter((item) => item !== option));
        }
      };
      return (
        <fieldset aria-describedby={describedBy} aria-invalid={error ? true : undefined}>
          <legend id={`${id}-label`} className="mb-2 text-sm font-medium">
            {label}
          </legend>
          <div className="grid gap-1">
            {field.options!.map((o, i) => (
              <div
                key={o.value}
                className="flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-accent sm:min-h-9"
              >
                <Checkbox
                  id={i === 0 ? id : undefined}
                  aria-label={o.label}
                  disabled={disabled}
                  checked={list.includes(o.value)}
                  onCheckedChange={(checked) => updateSelection(o.value, checked === true)}
                />
                <span className="min-w-0 text-sm">{o.label}</span>
              </div>
            ))}
          </div>
          {field.help && (
            <p id={helpId} className="mt-1 text-xs text-muted-foreground">
              {field.help}
            </p>
          )}
          {error && (
            <p id={errorId} className="mt-1 text-xs text-destructive">
              {error}
            </p>
          )}
        </fieldset>
      );
    }
  }
  return (
    <div className="min-w-0 max-w-full space-y-1.5">
      <Label htmlFor={id} id={`${id}-label`} className="text-sm font-medium">
        {label}
      </Label>
      {control}
      {field.help && (
        <p id={helpId} className="text-xs text-muted-foreground">
          {field.help}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function TableBody({
  block,
  locked,
  initial,
  onDraft,
  onSubmit,
}: {
  block: InteractiveTable;
  locked: boolean;
  initial?: string[];
  onDraft: (selected: string[]) => void;
  onSubmit: (s: InteractiveSubmission) => void;
}) {
  const valid = useMemo(() => new Set(block.rows.map((r) => r.id)), [block.rows]);
  const [selected, setSelected] = useState<string[]>(() =>
    (initial ?? []).filter((id) => valid.has(id)),
  );
  const selectable = block.selection !== "none";
  const toggle = (rowId: string) => {
    if (locked) return;
    const next =
      block.selection === "single"
        ? [rowId]
        : selected.includes(rowId)
          ? selected.filter((x) => x !== rowId)
          : [...selected, rowId];
    setSelected(next);
    onDraft(next);
  };
  const group = useId();
  return (
    <div>
      <div
        className="-mx-1 overflow-x-auto px-1"
        role="region"
        aria-label={block.title}
        tabIndex={0}
      >
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              {selectable && (
                <th scope="col" className="w-10 py-2">
                  <span className="sr-only">Select</span>
                </th>
              )}
              {block.columns.map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  className={`px-2 py-2 font-medium ${c.align === "end" ? "text-right" : "text-left"}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => {
              const isSel = selected.includes(row.id);
              return (
                <tr
                  key={row.id}
                  className={`border-b border-border last:border-0 ${isSel ? "bg-accent" : ""} ${selectable && !locked ? "cursor-pointer hover:bg-accent/60" : ""}`}
                  onClick={selectable ? () => toggle(row.id) : undefined}
                >
                  {selectable && (
                    <td className="py-2 pl-1" onClick={(e) => e.stopPropagation()}>
                      {block.selection === "single" ? (
                        <input
                          type="radio"
                          name={group}
                          checked={isSel}
                          disabled={locked}
                          onChange={() => toggle(row.id)}
                          aria-label={`Select ${row.cells[0]}`}
                          className="h-4 w-4 accent-foreground"
                        />
                      ) : (
                        <Checkbox
                          checked={isSel}
                          disabled={locked}
                          onCheckedChange={() => toggle(row.id)}
                          aria-label={`Select ${row.cells[0]}`}
                        />
                      )}
                    </td>
                  )}
                  {row.cells.map((cell, i) => (
                    <td
                      key={i}
                      className={`px-2 py-2 ${block.columns[i].align === "end" ? "text-right tabular-nums" : ""}`}
                    >
                      {String(cell)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selectable && (
        <Button
          type="button"
          className="mt-3 h-auto min-h-11 max-w-full whitespace-normal sm:min-h-9"
          disabled={locked || selected.length === 0}
          onClick={() => onSubmit({ selected })}
        >
          {block.submitLabel ?? "Submit"}
        </Button>
      )}
    </div>
  );
}
