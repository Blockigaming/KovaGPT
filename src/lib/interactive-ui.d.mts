export type InteractiveOption = { value: string; label: string };
export type InteractiveFieldKind =
  "text" | "textarea" | "number" | "radio" | "checkbox" | "select" | "slider" | "date" | "toggle";
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
export type InteractiveBlock = InteractiveForm | InteractiveTable;
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
