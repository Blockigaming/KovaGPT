export const ORGANIZATION_MAX_BODY_BYTES: number;
export const ORGANIZATION_PAGE_LIMIT: number;
export class OrganizationInputError extends Error {
  code: string;
  constructor(code?: string);
}
export function normalizeOrganizationDomain(value: unknown): string;
export function organizationAvailability(env?: Record<string, string | undefined>): {
  available: boolean;
  canClose: boolean;
  retentionEnforced: boolean;
};
export function parseOrganizationMutation(value: unknown): {
  action: string;
  organizationId: string;
  expectedRevision: number;
  mutationId: string;
  payload: Record<string, unknown>;
};
export function parseOrganizationQuery(url: string): {
  organizationId: string | null;
  view: string;
  cursor: number;
  through: number | null;
  limit: number;
};
