export type AuthValidationDisposition =
  | {
      kind: "valid";
      clearBrowserStorage: false;
      signOut: false;
      principalResolution: "authenticated";
    }
  | {
      kind: "retryable";
      clearBrowserStorage: false;
      signOut: false;
      principalResolution: "unresolved";
    }
  | {
      kind: "terminal";
      clearBrowserStorage: true;
      signOut: true;
      principalResolution: "guest";
    };

export type AuthValidationErrorLike = {
  name?: string;
  code?: string;
  status?: number;
  message?: string;
};

export function isTerminalUserValidationError(error: unknown): boolean;
export function classifyAuthValidationResult(options?: {
  userError?: unknown;
  assuranceError?: unknown;
  userPresent?: boolean;
  userIdMatches?: boolean;
  userDeleted?: boolean;
  userBanned?: boolean;
}): AuthValidationDisposition;
export function classifyThrownAuthValidationError(
  error: unknown,
): Extract<AuthValidationDisposition, { kind: "retryable" }>;
export function classifySessionRestoreError(
  error: unknown,
): Exclude<AuthValidationDisposition, { kind: "valid" }>;
export function isCurrentAuthValidation(
  capturedValidation: number,
  currentValidation: number,
  cancelled?: boolean,
): boolean;
export function retryableAuthPrincipalState(
  candidateUserId: string | null | undefined,
  validatedUserId: string | null | undefined,
):
  | { principalResolution: "authenticated"; userId: string }
  | { principalResolution: "unresolved"; userId: null };
