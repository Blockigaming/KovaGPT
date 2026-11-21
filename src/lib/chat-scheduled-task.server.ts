import { createHash } from "node:crypto";
import { z } from "zod";
import { parseTaskPayload } from "@/lib/scheduled-task-policy.mjs";
import { persistScheduledTask } from "@/lib/scheduled-tasks.functions";
import { taskCreatedReceiptFromResult } from "@/lib/task-created-receipt.mjs";

const politePrefix = /^(?:(?:please|hey kova[,!]?|can you|could you|would you|i want you to)\s+)*/i;
const scheduleCommand =
  /^(?:remind me\b|(?:set(?: up)?|create|add|make)\s+(?:(?:a|an|my|new)\s+)*(?:scheduled task|recurring (?:task|reminder)|reminder|automation)\b|schedule\s+(?!(?:a|my|the)\s+(?:call|meeting|appointment)\b))/i;
const recurringCommand =
  /^(?:every\s+[^\n]{1,80}?(?:,\s*|\s+)(?:remind me|send me|give me|check|tell me)\b|(?:check|tell me|give me|send me|notify me|summarize|research)\b[^\n]{0,1000}\bevery\s+(?:day|morning|evening|night|week|month|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b)/i;

export function requestsScheduledTask(text: string) {
  const command = text.trim().replace(politePrefix, "");
  return scheduleCommand.test(command) || recurringCommand.test(command);
}

export function scheduledTaskRequestText(
  messages: readonly { role: string; content?: string | null }[],
  lastText: string,
) {
  if (requestsScheduledTask(lastText)) return lastText;
  const [initial, question, answer] = messages.slice(-3);
  if (
    initial?.role !== "user" ||
    !initial.content ||
    !requestsScheduledTask(initial.content) ||
    question?.role !== "assistant" ||
    !/\b(?:what time|what date|which day|which time zone|when should|when would)\b[^?]{0,140}\?/i.test(
      question.content ?? "",
    ) ||
    answer?.role !== "user" ||
    !lastText ||
    lastText.length > 140 ||
    !/\b(?:[0-9]{1,4}|\d{1,2}(?:am|pm)|tomorrow|today|morning|evening|noon|midnight|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i.test(
      lastText,
    )
  )
    return null;
  return `Original request: ${initial.content}\nSchedule clarification: ${lastText}`;
}

export const chatScheduledTaskTool = {
  type: "function" as const,
  function: {
    name: "create_scheduled_task",
    description:
      "Create one private, time-based task for the current user. Its output will appear in Scheduled Tasks. Use only for requests to run later. Ask a question if the task, date or time is missing. Do not use for calendar events, external delivery, or connected-account actions.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", maxLength: 200 },
        prompt: { type: "string", maxLength: 4000 },
        localTime: {
          type: "string",
          description: "First future run in local time, YYYY-MM-DDTHH:mm, without an offset.",
        },
        timezone: {
          type: "string",
          description: "IANA time zone requested by the user or supplied by the app.",
        },
        repeat: { type: "string", enum: ["none", "daily", "weekly", "monthly"] },
      },
      required: ["title", "prompt", "localTime", "timezone", "repeat"],
    },
  },
};

export const chatScheduleInstructions =
  "The latest user text requests a future task. Use create_scheduled_task for one clearly authorized, private task or reminder when the instructions, local date and time, time zone, and cadence are known. Ask a brief question for missing details. Do not assume a time of day. A named weekday recurring schedule is weekly. Scheduled output appears inside KovaGPT. If the user needs external delivery or an unavailable cadence, explain the available options. Never say a task was created unless the tool returns status created.";

const scheduleArgs = z
  .object({
    title: z.string(),
    prompt: z.string(),
    localTime: z.string(),
    timezone: z.string(),
    repeat: z.enum(["none", "daily", "weekly", "monthly"]),
  })
  .strict();

function taskIdForTurn(userId: string, turnId: string) {
  const hex = createHash("sha256")
    .update(JSON.stringify(["chat-scheduled-task", userId, turnId]))
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function createChatScheduledTask(input: {
  request: Request;
  userId: string;
  turnId: string;
  args: unknown;
}) {
  const parsed = scheduleArgs.safeParse(input.args);
  if (!parsed.success)
    return {
      status: "not-created" as const,
      reason: "The task needs a title, instructions, and a valid date and time.",
    };
  let payload;
  try {
    payload = parseTaskPayload(parsed.data);
  } catch {
    return {
      status: "not-created" as const,
      reason: "Check the requested date, time, and time zone.",
    };
  }
  try {
    input.request.signal.throwIfAborted();
    const id = taskIdForTurn(input.userId, input.turnId);
    const task = await persistScheduledTask(
      input.userId,
      { id, mutationId: id, payload },
      input.request,
    );
    const receipt = taskCreatedReceiptFromResult(task);
    if (receipt)
      return {
        status: "created" as const,
        receipt,
        title: task.title,
        nextRun: task.next_run_at,
        timezone: task.timezone,
        repeat: task.repeat,
      };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Background execution is not ready. Your task was not started."
    )
      return {
        status: "not-created" as const,
        reason: "The background scheduler is unavailable. Try again when execution is available.",
      };
  }
  return {
    status: "unconfirmed" as const,
    reason: "Open Scheduled Tasks to check the result before trying again.",
  };
}
