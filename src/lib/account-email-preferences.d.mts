export type AccountEmailEvent =
  | "password_changed"
  | "security_method_added"
  | "security_method_changed"
  | "security_method_removed"
  | "account_deletion_scheduled"
  | "account_deleted"
  | "new_login"
  | "email_changed"
  | "account_recovered";
export type AccountEmailPreferences = Record<AccountEmailEvent, boolean>;
export const ACCOUNT_EMAIL_EVENTS: ReadonlyArray<
  Readonly<{
    key: AccountEmailEvent;
    label: string;
    description: string;
    defaultEnabled: boolean;
  }>
>;
export const DEFAULT_ACCOUNT_EMAIL_PREFERENCES: Readonly<AccountEmailPreferences>;
export function parseAccountEmailPreferencePatch(
  value: unknown,
): Partial<AccountEmailPreferences> | null;
export function parseAccountEmailPreferences(value: unknown): AccountEmailPreferences | null;
