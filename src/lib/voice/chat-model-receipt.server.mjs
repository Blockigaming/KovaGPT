import { consumeChatSse } from "../chat-sse-client.mjs";
import {
  issueVoiceModelReceipt,
  issueVoiceSegmentReceipt,
} from "./openai-model-eligibility.server.mjs";
import { createSpeechSegmenter } from "./speech-segmenter.mjs";

// The same normalized events are sent to the browser and assembled here. A
// receipt is issued only after a complete provider stream, for the exact text
// that the browser will persist. Partial, failed, or oversized replies get none.
export async function relayEligibleVoiceChat(stream, { signal, emit, policy, identity }) {
  let content = "";
  let tooLong = false;
  const segmenter = createSpeechSegmenter();
  let segmentIndex = 0;
  // Signed segments let the browser start speech while the model is still
  // generating. Each is bound to this exact reply, index and text.
  const emitSegments = (segments) => {
    for (const text of segments) {
      const receipt = issueVoiceSegmentReceipt(policy, {
        ...identity,
        index: segmentIndex,
        text,
      });
      if (!receipt) continue;
      // Same envelope as every other chat SSE extension event (see sseEvent in chat.ts).
      const delta = {
        role: "assistant",
        kind: "voice_segment",
        chatId: identity.chatId,
        messageId: identity.messageId,
        index: segmentIndex,
        text,
        receipt,
      };
      emit(`data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`);
      segmentIndex++;
    }
  };
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
      } else {
        content += delta.content;
        emitSegments(segmenter.push(delta.content));
      }
    },
  });
  if (!tooLong && !nonStopFinish && !signal?.aborted) emitSegments(segmenter.flush());
  if (tooLong || nonStopFinish || !content.trim() || signal?.aborted) return null;
  return issueVoiceModelReceipt(policy, { ...identity, content });
}
