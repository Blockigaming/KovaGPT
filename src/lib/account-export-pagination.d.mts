type Row = Record<string, unknown>;
type Query = {
  order(column: string, options: { ascending: boolean }): Query;
  range(from: number, to: number): PromiseLike<{ data: Row[] | null; error: unknown }>;
};
export function readAccountExportRows(
  makeQuery: () => Query,
  table: string,
  pageSize: number,
  maximumRows: number,
): Promise<Row[]>;
