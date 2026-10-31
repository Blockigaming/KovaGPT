export type ConnectionFlow = {
  provider: string;
  scopes: string[];
  tool: string;
  label: string;
  description: string;
};
export type ConnectedAccount = {
  id: string;
  provider_id: string;
  account_label: string | null;
  status: string;
  granted_scopes: string[];
  token_expires_at: string | null;
  deleted_at?: string | null;
  updated_at?: string;
};
export const CONNECTION_FLOWS: Record<string, ConnectionFlow>;
export function hasConnectionScopes(scopes: string[], required: string[]): boolean;
export function connectionAccounts<T extends ConnectedAccount>(accounts: T[], id: string): T[];
export function canReadConnection(account: ConnectedAccount, id: string, now?: number): boolean;
export function safeConnectionLink(value: unknown): string | null;
export function connectionAuthorizationUrl(provider: string, value: unknown): string | null;
