import type { ConnectionReadResult } from "./connection-read.server.mjs";
export type SalesforceRecordType = "accounts" | "contacts" | "opportunities";
export function salesforceReadRequest(
  query: string,
  packed: string,
  recordType?: SalesforceRecordType,
): { url: string; init: RequestInit };
export function salesforceReadResult(
  data: Record<string, unknown>,
  packed: string,
  recordType?: SalesforceRecordType,
): ConnectionReadResult;
