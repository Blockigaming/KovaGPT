import type {
  AccountDeletionGraceStatus,
  AccountDeletionSchedule,
} from "../src/components/AccountDeletionGraceView";
export const ACCOUNT_DELETION_REVIEW_LABEL: string;
export const ACCOUNT_DELETION_PREVIEW_STATES: readonly string[];
export const SAMPLE_REQUESTED_AT: string;
export const SAMPLE_EFFECTIVE_AT: string;
export interface AccountDeletionPreviewState {
  ownerId: string;
  generation: number;
  open: boolean;
  status: AccountDeletionGraceStatus;
  schedule?: AccountDeletionSchedule;
}
export type AccountDeletionPreviewEvent =
  | { type: "switch-owner"; nextOwnerId: string }
  | { type: "fixture"; ownerId: string; generation: number; fixture: string }
  | { type: "open" | "close" | "check-status"; ownerId: string; generation: number }
  | {
      type: "schedule" | "recover";
      ownerId: string;
      generation: number;
      result: "success" | "failure";
    };
export function createAccountDeletionPreview(
  ownerId?: string,
  fixture?: string,
  generation?: number,
): AccountDeletionPreviewState;
export function accountDeletionPreviewReducer(
  state: AccountDeletionPreviewState,
  event: AccountDeletionPreviewEvent,
): AccountDeletionPreviewState;
