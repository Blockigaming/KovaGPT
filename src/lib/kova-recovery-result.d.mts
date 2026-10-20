export const KOVA_RECOVERY_UNCONFIRMED_MESSAGE: string;
export function classifyKovaRecoveryResetResponse(
  status: number,
  payload: unknown,
): {
  confirmed: boolean;
  preserveDraft: boolean;
  message: string;
};
