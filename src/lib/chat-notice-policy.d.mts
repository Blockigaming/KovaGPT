export type ChatFailureNoticeError = {
  code?: string;
  category?: string;
  status?: number;
  usageKind?: "thinking" | "regular";
};
export declare function chatFailureNoticeId(
  error: ChatFailureNoticeError | null | undefined,
  options?: { signedIn?: boolean; networkFailure?: boolean },
): string;
