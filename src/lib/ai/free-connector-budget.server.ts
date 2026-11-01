import { estimateProviderInput } from "./token-estimator.server";

type Usage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};
type Message = { role: string; content: unknown };

const zeroUsage = (): Usage => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
});

function reportedUsage(raw: unknown): Usage | null {
  if (!raw || typeof raw !== "object") return null;
  const usage = raw as Record<string, unknown>;
  const input = usage.prompt_tokens ?? usage.input_tokens;
  const output = usage.completion_tokens ?? usage.output_tokens;
  if (!Number.isSafeInteger(input) || Number(input) < 0) return null;
  if (!Number.isSafeInteger(output) || Number(output) < 0) return null;
  const inputDetails = (usage.input_tokens_details ?? usage.prompt_tokens_details) as
    Record<string, unknown> | undefined;
  const outputDetails = (usage.output_tokens_details ?? usage.completion_tokens_details) as
    Record<string, unknown> | undefined;
  const boundedDetail = (value: unknown, maximum: number) =>
    Number.isSafeInteger(value) && Number(value) >= 0 ? Math.min(Number(value), maximum) : 0;
  return {
    inputTokens: Number(input),
    cachedInputTokens: boundedDetail(inputDetails?.cached_tokens, Number(input)),
    outputTokens: Number(output),
    reasoningTokens: boundedDetail(outputDetails?.reasoning_tokens, Number(output)),
  };
}

/** One bounded planning call and one final call, within the existing Free allowance. */
export class FreeConnectorBudget {
  readonly planningInputTokens: number;
  readonly planningOutputTokens: number;
  readonly finalInputTokenLimit: number;
  readonly finalOutputTokens: number;
  readonly reservedTokens: number;
  private planningUsage = zeroUsage();
  private finalUsage = zeroUsage();
  private planningStarted = false;
  private finalStarted = false;

  constructor(input: {
    planningMessages: unknown;
    finalMessages: unknown;
    tools: unknown;
    outputCeiling: number;
    tokenLimit: number;
  }) {
    const { outputCeiling, tokenLimit } = input;
    if (
      !Number.isSafeInteger(outputCeiling) ||
      outputCeiling < 1 ||
      !Number.isSafeInteger(tokenLimit) ||
      tokenLimit < 1
    )
      throw new Error("invalid_connector_budget");
    // Include schemas in planning, and reserve separate room for the arguments,
    // result envelopes and source excerpts that will be repeated in the final call.
    this.planningInputTokens =
      estimateProviderInput({ messages: input.planningMessages, tools: input.tools }).tokens + 128;
    this.planningOutputTokens = Math.min(1_024, outputCeiling);
    this.finalInputTokenLimit =
      estimateProviderInput({ messages: input.finalMessages }).tokens + 1_536 + 128;
    const remainingOutput =
      tokenLimit - this.planningInputTokens - this.planningOutputTokens - this.finalInputTokenLimit;
    this.finalOutputTokens = Math.min(outputCeiling, remainingOutput);
    if (this.finalOutputTokens < Math.min(1_024, outputCeiling))
      throw new Error("connector_request_budget_exceeded");
    this.reservedTokens =
      this.planningInputTokens +
      this.planningOutputTokens +
      this.finalInputTokenLimit +
      this.finalOutputTokens;
  }

  startPlanning(): void {
    if (this.planningStarted || this.finalStarted)
      throw new Error("connector_call_budget_exceeded");
    this.planningStarted = true;
    // Unknown/aborted responses retain a conservative charge. A valid usage
    // receipt replaces it, including reasoning and function-call output tokens.
    this.planningUsage = {
      ...zeroUsage(),
      inputTokens: this.planningInputTokens,
      outputTokens: this.planningOutputTokens,
    };
  }

  reportPlanning(raw: Record<string, unknown>): boolean {
    const usage = reportedUsage(raw.usage);
    if (usage) this.planningUsage = usage;
    return (
      this.planningUsage.inputTokens <= this.planningInputTokens &&
      this.planningUsage.outputTokens <= this.planningOutputTokens
    );
  }

  rejectPlanning(status: number): void {
    if (status >= 400 && status < 500) this.planningUsage = zeroUsage();
  }

  /** Preserve every tool-call ID; only shorten source-result text, with a visible marker. */
  boundFinalMessages<T extends Message>(messages: T[]): T[] | null {
    const result = messages.map((message) => ({ ...message }));
    const excerpts = new Map<number, { original: string; length: number }>();
    for (let index = 0; index < result.length; index++) {
      const message = result[index];
      if (message.role === "tool" && typeof message.content === "string")
        excerpts.set(index, { original: message.content, length: message.content.length });
    }
    for (let step = 0; step <= 256; step++) {
      if (estimateProviderInput({ messages: result }).tokens + 128 <= this.finalInputTokenLimit)
        return result;
      let largest = -1;
      for (const [index, excerpt] of excerpts) {
        if (excerpt.length > 0 && (largest < 0 || excerpt.length > excerpts.get(largest)!.length))
          largest = index;
      }
      if (largest < 0) return null;
      const excerpt = excerpts.get(largest)!;
      excerpt.length = Math.floor(excerpt.length / 2);
      result[largest].content = JSON.stringify({
        source_excerpt_truncated: true,
        content: excerpt.original.slice(0, excerpt.length),
        notice: "Only this excerpt is available. Do not claim to have read the omitted source.",
      });
    }
    return null;
  }

  startFinal(messages: unknown): void {
    if (this.finalStarted) throw new Error("connector_call_budget_exceeded");
    const tokens = estimateProviderInput({ messages }).tokens + 128;
    if (tokens > this.finalInputTokenLimit) throw new Error("connector_request_budget_exceeded");
    this.finalStarted = true;
    this.finalUsage = {
      ...zeroUsage(),
      inputTokens: tokens,
      outputTokens: this.finalOutputTokens,
    };
  }

  rejectFinal(status: number): void {
    if (status >= 400 && status < 500) this.finalUsage = zeroUsage();
  }

  reportFinal(raw: unknown): void {
    const usage = reportedUsage(raw);
    if (usage) this.finalUsage = usage;
  }

  usage(): Usage {
    return {
      inputTokens: this.planningUsage.inputTokens + this.finalUsage.inputTokens,
      cachedInputTokens: this.planningUsage.cachedInputTokens + this.finalUsage.cachedInputTokens,
      outputTokens: this.planningUsage.outputTokens + this.finalUsage.outputTokens,
      reasoningTokens: this.planningUsage.reasoningTokens + this.finalUsage.reasoningTokens,
    };
  }
}
