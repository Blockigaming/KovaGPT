// Narrow service-side types for tables already present in the database. These
// are not schema migrations and do not grant browser access to credentials.
type Table<Row extends Record<string, unknown>> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};
type FinanceConnection = {
  id: string;
  owner_id: string;
  provider: string;
  item_reference_ciphertext: string;
  status: string;
  consented_products: string[];
  country: string;
  last_posted_at: string | null;
  created_at: string;
  deleted_at: string | null;
};
type LinkedAccount = {
  id: string;
  owner_id: string;
  provider_id: string;
  workspace_id: string | null;
  status: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string | null;
  token_expires_at: string | null;
  granted_scopes: string[];
  updated_at: string;
  deleted_at: string | null;
};
type IntegrationAudit = {
  id: string;
  owner_id: string;
  linked_account_id: string | null;
  provider_id: string;
  event_type: string;
  result: string;
  safe_summary: string;
  metadata: Record<string, unknown>;
};
type AccountAudit = {
  id: string;
  user_id: string;
  event_type: string;
  safe_description: string;
  result: string;
  metadata: Record<string, unknown>;
};
export type ConnectionDomainDatabase = {
  public: {
    Tables: {
      financial_connections: Table<FinanceConnection>;
      integration_linked_accounts: Table<LinkedAccount>;
      integration_audit_events: Table<IntegrationAudit>;
      account_audit_entries: Table<AccountAudit>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
