export const ACCEPTANCE_PROMPT: "Reply exactly: Kova speech test.";
export function acceptanceDigest(value: unknown): string;
export type AcceptancePlan = {
  version: 1;
  operationId: string;
  ownerId: string;
  chatId: string;
  notBefore: number;
  expiresAt: number;
  target: {
    environment: "ca-kovagpt-staging";
    commit: string;
    tree: string;
    imageDigest: string;
    revision: string;
    configurationEvidenceSha256: string;
  };
  openAI: {
    model: "gpt-5.6-luna";
    maximumOutputTokens: 64;
    userPrompt: typeof ACCEPTANCE_PROMPT;
    bodySha256: string;
    tokenCountEvidenceSha256: string;
    verifiedInputTokens: number;
    maximumInputUtf8Bytes: number;
  };
  speech: { model: "eleven_multilingual_v2"; maximumTextCharacters: 120; voiceId: string };
  quote: {
    currency: "USD";
    unit: "nanoUSD";
    pricingEvidenceSha256: string;
    verifiedAt: number;
    validUntil: number;
    inputPerMillion: string;
    outputPerMillion: string;
    speechPerCharacter: string;
    maximumTotal: string;
  };
};
export type AcceptanceReceipt = {
  version: 1;
  planSha256: string;
  approvedMaximumCostNanos: string;
  approvedAt: number;
  expiresAt: number;
  authorizationEvidenceSha256: string;
};
export type AcceptanceConfig =
  | { enabled: false }
  | {
      enabled: true;
      plan: AcceptancePlan;
      expectedPlanSha256: string;
      approvalReceipt: AcceptanceReceipt;
      expectedApprovalReceiptSha256: string;
    };
export function createGenerationAcceptanceGuard(options: {
  getConfig(): AcceptanceConfig | undefined;
  claim(input: {
    identity: string;
    action: string;
    limit: number;
    windowSeconds: number;
  }): Promise<{
    allowed: boolean;
    retryAfter: number;
  }>;
  now?(): number;
}): {
  run<T>(scope: { ownerId: string; operationId: string; chatId: string }, operation: () => T): T;
  openAI(input: {
    provider: string;
    path: string;
    body: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<{
    maximumCostNanos: string;
    expiresAt: number;
    body: Record<string, unknown>;
  } | null>;
  speech(input: {
    ownerId: string;
    chatId: string;
    messageId: string;
    voiceId: string;
    modelId: string;
    text: string;
    signal?: AbortSignal;
  }): Promise<{ maximumCostNanos: string; expiresAt: number } | null>;
};
