export type ScimKind = "Users" | "Groups";
export type ScimResource = {
  externalId: string;
  displayName: string;
  userName?: string;
  active?: boolean;
  members?: { value: string }[];
};
export type ScimRow = {
  id: string;
  external_id: string;
  display_name: string;
  user_name?: string;
  active?: boolean;
  revision: number;
  created_at: string;
  updated_at: string;
  members?: string[];
};
export const SCIM_SCHEMA: Readonly<Record<"user" | "group" | "patch" | "list" | "error", string>>;
export class ScimError extends Error {
  status: number;
  code: string;
  constructor(status: number, code?: string);
}
export function scimUuid(value: unknown): string;
export function parseScimResource(kind: ScimKind, input: unknown): ScimResource;
export function scimIfMatch(value: string | null): number;
export function parseScimQuery(
  url: string,
  kind: ScimKind,
): { startIndex: number; count: number; filter: { field: string; value: string } | null };
export function applyScimPatch(
  kind: ScimKind,
  current: Record<string, unknown>,
  input: unknown,
): ScimResource;
export function scimDocument(
  kind: ScimKind,
  row: ScimRow,
  base: string,
): Record<string, unknown> & { meta: { version: string; location: string } };
export function scimConfiguration(): Record<string, unknown>;
export function scimDiscovery(
  name: "Schemas" | "ResourceTypes",
  id?: string,
): Record<string, unknown>;
