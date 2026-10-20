export type KovaAccountEmailEvent =
  | "password_changed"
  | "security_method_added"
  | "security_method_changed"
  | "security_method_removed"
  | "account_deletion_scheduled"
  | "account_deleted"
  | "new_login"
  | "email_changed"
  | "account_recovered"
  | "welcome";

export function renderKovaAccountEmail(input: {
  event: KovaAccountEmailEvent;
  publicOrigin: string;
  occurredAt: string;
  deletionScheduledFor?: string;
}): { subject: string; html: string; text: string };
