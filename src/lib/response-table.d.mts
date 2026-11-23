export type TableModel = { header: string[]; rows: string[][] };
export function tableModelFromHast(node: unknown): TableModel;
export function compareCells(a?: string, b?: string): number;
export function rowsToDelimited(rows: string[][], delimiter?: "," | "\t"): string;
