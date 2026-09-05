type Row = Record<string, unknown>;
type Query = {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  order(column: string, options: { ascending: boolean }): Query;
  range(from: number, to: number): PromiseLike<{ data: Row[] | null; error: unknown }>;
  maybeSingle(): PromiseLike<{ data: Row | null; error: unknown }>;
};
export function readAccountExportSiteFiles(
  admin: { from(table: string): Query },
  ownerId: string,
  remainingBytes: number,
): Promise<Row[]>;
