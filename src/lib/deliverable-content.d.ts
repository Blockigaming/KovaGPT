declare module "@/lib/deliverable-content.mjs" {
  export type PreviewLimits = {
    bytes: number;
    csvRows: number;
    csvColumns: number;
    cellChars: number;
    jsonNodes: number;
  };
  export type CsvPreview = {
    delimiter: string;
    headers: string[];
    rows: string[][];
    rowCount: number;
    columnCount: number;
    malformed: number;
    truncated: boolean;
  };
  export type DiffValue =
    null | boolean | number | string | DiffValue[] | { [key: string]: DiffValue };
  export const PREVIEW_LIMITS: PreviewLimits;
  export function sanitizeMarkup(value: string): string;
  export function parseCsv(text: string, limits?: PreviewLimits): CsvPreview;
  export function textDiff(
    before: string,
    after: string,
    ignoreWhitespace?: boolean,
  ): {
    lines: Array<{
      kind: "added" | "removed" | "changed" | "same";
      before?: string;
      after?: string;
      line: number;
    }>;
    added: number;
    removed: number;
    modified: number;
  };
  export function jsonDiff(
    before: DiffValue,
    after: DiffValue,
    path?: string,
  ): Array<{ path: string; kind: string; before?: DiffValue; after?: DiffValue }>;
  export function csvDiff(
    before: string,
    after: string,
    keyColumn?: string,
  ): {
    addedColumns: string[];
    removedColumns: string[];
    addedRows: number;
    removedRows: number;
    changedCells: number;
    keyColumn: string | null;
  };
}
