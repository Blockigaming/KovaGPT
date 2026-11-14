export type InteractiveOption = { value: string; label: string };
export type InteractiveFieldKind =
  | "text"
  | "search"
  | "time"
  | "color"
  | "textarea"
  | "number"
  | "radio"
  | "checkbox"
  | "select"
  | "slider"
  | "date"
  | "toggle";
export type InteractiveField = {
  id: string;
  label: string;
  kind: InteractiveFieldKind;
  required: boolean;
  help?: string;
  placeholder?: string;
  options?: InteractiveOption[];
  min?: number | string;
  max?: number | string;
  step?: number;
  default?: string | number | boolean | string[];
};
export type InteractiveAction = { id: string; label: string; style: "primary" | "secondary" };
export type InteractiveForm = {
  version: 1;
  type: "form";
  id: string;
  title: string;
  description?: string;
  fields: InteractiveField[];
  submitLabel?: string;
  actions: InteractiveAction[];
};
export type InteractiveTable = {
  version: 1;
  type: "table";
  id: string;
  title: string;
  description?: string;
  columns: { id: string; label: string; align: "start" | "end" }[];
  rows: { id: string; cells: (string | number)[] }[];
  selection: "none" | "single" | "multiple";
  submitLabel?: string;
};
export type Flashcard = { front: string; back: string };
export type QuizCard = Flashcard & { hint?: string } & (
    | { kind: "choice"; options: InteractiveOption[]; answer: string }
    | { kind: "multiple" | "ordering"; options: InteractiveOption[]; answer: string[] }
    | {
        kind: "matching";
        items: InteractiveOption[];
        options: InteractiveOption[];
        answer: string[];
      }
    | { kind: "number"; answer: number; tolerance: number }
    | { kind: "short"; answer: string[] }
  );
type StudyDeck = { version: 1; id: string; title: string; description?: string };
export type StudyBlock =
  | (StudyDeck & { type: "flashcards"; cards: Flashcard[]; adaptive?: boolean })
  | (StudyDeck & {
      type: "quiz";
      cards: QuizCard[];
      adaptive?: boolean;
      secondsPerQuestion?: number;
    });
export type SimulationRange = { min: number; max: number; step: number; value: number };
export type SimulationModel =
  | "linear"
  | "quadratic"
  | "rectangle"
  | "compound-interest"
  | "constant-acceleration"
  | "independent-events"
  | "molarity";
export type SimulationBlock = StudyDeck & {
  type: "simulation";
  model: SimulationModel;
  inputs: Record<string, SimulationRange>;
};
export type DiagramBlock = StudyDeck & {
  type: "diagram";
  nodes: {
    id: string;
    label: string;
    x: number;
    y: number;
    shape: "box" | "decision" | "terminal";
  }[];
  edges: { from: string; to: string; label?: string }[];
};
export type PatternBlock = StudyDeck & {
  type: "pattern";
  pattern: "stripes" | "dots" | "checks" | "gradient";
  colors: [string, string];
};
export type FileBundleBlock = StudyDeck & {
  type: "files";
  files: { name: string; content: string }[];
};
export type MemoryGameBlock = StudyDeck & {
  type: "memory-game";
  pairs: { first: string; second: string }[];
};
export type SpeechBlock = StudyDeck & { type: "speech"; script: string };
export type InteractiveBlock =
  | InteractiveForm
  | InteractiveTable
  | StudyBlock
  | SimulationBlock
  | DiagramBlock
  | PatternBlock
  | FileBundleBlock
  | MemoryGameBlock
  | SpeechBlock;
export type FormValue = string | number | boolean | string[];
export type FormValues = Record<string, FormValue>;
export type InteractiveSubmission = { values?: FormValues; action?: string; selected?: string[] };
export type InteractivePart =
  { kind: "text"; text: string } | { kind: "interactive"; block: InteractiveBlock; index: number };
export const FIELD_KINDS: InteractiveFieldKind[];
export function validateInteractiveBlock(value: unknown): InteractiveBlock | null;
export function initialFormValues(block: InteractiveForm): FormValues;
export function validateFormValues(
  block: InteractiveForm,
  values: FormValues,
): Record<string, string>;
export function formatSubmission(
  block: InteractiveBlock,
  submission: InteractiveSubmission,
): string;
export function splitInteractiveContent(value: string): InteractivePart[];
export const INTERACTIVE_UI_INSTRUCTIONS: string;
export const INTELLIGENT_INTERFACE_NAME: "Intelligent Interface";
