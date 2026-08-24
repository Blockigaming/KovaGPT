export const MIN_SELECTION_CHARS: number;
export const MAX_SELECTION_CHARS: number;
export const MAX_EDIT_INSTRUCTION_CHARS: number;

export type SelectionEditErrorCode =
  | "empty"
  | "too_short"
  | "too_long"
  | "not_found"
  | "ambiguous"
  | "bad_range"
  | "fence_unbalanced"
  | "empty_result";

export const SELECTION_EDIT_ERRORS: Readonly<Record<SelectionEditErrorCode, string>>;

export function selectionEditError(code: SelectionEditErrorCode): Error;
export function fenceCount(value: string): number;
export function locateSelection(
  source: string,
  selectedText: string,
): { start: number; end: number };
export function validateSelectionRange(
  source: string,
  start: number,
  end: number,
): { start: number; end: number; prefix: string; selected: string; suffix: string };
export function normalizeRewrite(raw: string, selected: string): string;
export function applySelectionEdit(
  source: string,
  start: number,
  end: number,
  replacement: string,
): string;
export function buildRewriteInstruction(
  instruction: string,
  selected: string,
  context?: { before?: string; after?: string },
): string;
export function selectionContext(
  source: string,
  start: number,
  end: number,
  window?: number,
): { before: string; after: string };
export function describeRewriteFailure(status: number, code?: string): string;
