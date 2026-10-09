export type LaunchConnectorId =
  | "outlook"
  | "onedrive"
  | "sharepoint"
  | "ms-teams"
  | "notion"
  | "linear"
  | "slack"
  | "salesforce"
  | "hubspot";
export type LaunchContract = {
  name: string;
  family: string;
  env: string;
  pkce: boolean;
  authorize: string;
  token: string;
  scopes: readonly string[];
  permissions: readonly string[];
};
export const LAUNCH_CONNECTORS: Readonly<Record<LaunchConnectorId, LaunchContract>>;
export const CERTIFIED_LAUNCH_CONNECTORS: readonly LaunchConnectorId[];
export const LAUNCH_OPERATIONS: Readonly<Record<LaunchConnectorId, Record<string, string[]>>>;
export class ConnectorError extends Error {
  code: string;
  status: number;
  constructor(code: string, status?: number);
}
export function isLaunchConnector(id: unknown): id is LaunchConnectorId;
export function requireLaunchConnector(id: string): LaunchContract;
export function assertLaunchCertified(id: string): void;
export function normalizeScopes(value: unknown): string[];
export function requirePermissions(id: string, scopes: unknown): void;
export function validateOperation(
  id: string,
  operation: string,
  args?: Record<string, unknown>,
): Record<string, string>;
