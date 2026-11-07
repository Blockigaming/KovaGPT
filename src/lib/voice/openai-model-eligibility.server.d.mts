export type VoiceModelPolicy = {
  valid: boolean;
  models: Set<string>;
  hostedModels: Set<string>;
  secret?: string;
};

export type VoiceModelIdentity = {
  ownerId: string;
  chatId: string;
  messageId: string;
  content: string;
};

export type OpenAiVoiceModel = {
  provider: "openai" | "azure_openai" | "openrouter";
  modelId: string;
};

export function voiceModelPolicy(env: (name: string) => string | undefined): VoiceModelPolicy;
export function eligibleVoiceModel(
  policy: VoiceModelPolicy,
  candidate: { provider?: string; modelId?: string },
): boolean;
export function issueVoiceModelReceipt(
  policy: VoiceModelPolicy,
  identity: VoiceModelIdentity & { provider: string; modelId: string },
): string | null;
export function verifyVoiceModelReceipt(
  policy: VoiceModelPolicy,
  receipt: unknown,
  identity: VoiceModelIdentity,
): OpenAiVoiceModel | null;
