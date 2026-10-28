import type { VoiceModelPolicy } from "./openai-model-eligibility.server.mjs";
export function relayEligibleVoiceChat(
  stream: ReadableStream<Uint8Array>,
  options: {
    signal?: AbortSignal;
    emit(frame: string): void;
    policy: VoiceModelPolicy;
    identity: {
      ownerId: string;
      chatId: string;
      messageId: string;
      provider: string;
      modelId: string;
    };
  },
): Promise<string | null>;
