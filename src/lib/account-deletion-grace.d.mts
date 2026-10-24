export const ACCOUNT_DELETION_GRACE_MS: number;
export function accountDeletionDeadlinePassed(effectiveAt: string, observedAt: number): boolean;
export function canRecoverAccountDeletion(status: string, deadlinePassed?: boolean): boolean;
export function formatAccountDeletionDate(iso: string, timeZone: string): string;
