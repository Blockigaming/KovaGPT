/** Convert one completed, accounted hosted-tool result to the normal chat SSE contract. */
export function hostedChatResult(result) {
  const usage = result?.usage;
  if (
    typeof result?.text !== "string" ||
    !result.text.trim() ||
    !usage ||
    !Number.isSafeInteger(usage.input_tokens) ||
    usage.input_tokens < 0 ||
    !Number.isSafeInteger(usage.output_tokens) ||
    usage.output_tokens < 0
  )
    throw new Error("hosted_chat_result_invalid");
  const frames = [
    {
      choices: [
        { index: 0, delta: { role: "assistant", content: result.text }, finish_reason: null },
      ],
    },
    {
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: {
        prompt_tokens: usage.input_tokens,
        completion_tokens: usage.output_tokens,
        total_tokens: usage.input_tokens + usage.output_tokens,
        input_tokens_details: usage.input_tokens_details,
        output_tokens_details: usage.output_tokens_details,
      },
    },
  ];
  return new Response(
    frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n",
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
