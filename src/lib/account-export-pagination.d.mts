type Row = Record<string, unknown>;
export type AccountExportReadBudget = { assertAvailable(): void; reserve(rows: Row[]): void };
export function createAccountExportReadBudget(maximumBytes: number): AccountExportReadBudget;
type Query = {
  order(column: string, options: { ascending: boolean }): Query;
  range(from: number, to: number): PromiseLike<{ data: Row[] | null; error: unknown }>;
};
export function readAccountExportRows(
  makeQuery: () => Query,
  table: string,
  pageSize: number,
  maximumRows: number,
  budget?: AccountExportReadBudget,
): Promise<Row[]>;
