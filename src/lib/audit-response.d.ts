declare module "@/lib/audit-response.mjs" {
  export type AuditLogRow = {
    id: string;
    provider: string;
    action: string;
    status: string;
    resource_id: string | null;
    summary: string | null;
    created_at: string;
  };

  export function parseAuditLogRows(value: unknown): AuditLogRow[];
}
