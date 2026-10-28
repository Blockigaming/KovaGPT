import { consumeChatSse } from "../chat-sse-client.mjs";
import { issueVoiceModelReceipt } from "./openai-model-eligibility.server.mjs";

// The same normalized events are sent to the browser and assembled here. A
// receipt is issued only after a complete provider stream, for the exact text
// that the browser will persist. Partial, failed, or oversized replies get none.
export async function relayEligibleVoiceChat(stream, { signal, emit, policy, identity }) {
  let content = "";
  let tooLong = false;
  let nonStopFinish = false;
  await consumeChatSse(stream, {
    signal,
    onEvent(event) {
      const frame = `data: ${JSON.stringify(event)}\n\n`;
      emit(frame);
      const finishReason = event.choices?.[0]?.finish_reason;
      if (typeof finishReason === "string" && finishReason !== "stop") nonStopFinish = true;
      const delta = event.choices?.[0]?.delta;
      if (typeof delta?.content !== "string") return;
      if (tooLong || content.length + delta.content.length > 4_000) {
        tooLong = true;
        content = "";
      } else content += delta.content;
    },
  });
  if (tooLong || nonStopFinish || !content.trim() || signal?.aborted) return null;
  return issueVoiceModelReceipt(policy, { ...identity, content });
}
