import type { Message, ResearchProgress } from "@/lib/chat-store";

const statuses = new Set<ResearchProgress["status"]>([
  "created",
  "pending",
  "running",
  "complete",
  "failed",
  "canceled",
]);

export function applyResearchDelta(message: Message, delta: Record<string, unknown>): Message {
  if (delta.kind === "research_progress") {
    const progress = Number(delta.progress);
    const status = String(delta.status) as ResearchProgress["status"];
    if (
      typeof delta.stage !== "string" ||
      typeof delta.label !== "string" ||
      !statuses.has(status) ||
      !Number.isFinite(progress)
    )
      return message;

    const terminal = status === "complete" || status === "failed" || status === "canceled";
    return {
      ...message,
      researchProgress: {
        stage: delta.stage.slice(0, 80),
        label: delta.label.slice(0, 160),
        status,
        ...(typeof delta.detail === "string" && delta.detail
          ? { detail: delta.detail.slice(0, 240) }
          : {}),
        progress: Math.min(1, Math.max(0, progress)),
        warnings: message.researchProgress?.warnings,
      },
      ...(terminal && Array.isArray(message.activities)
        ? {
            activities: message.activities.map((activity) =>
              activity.status === "running"
                ? {
                    ...activity,
                    status: status === "complete" ? "done" : status,
                  }
                : activity,
            ),
          }
        : {}),
    };
  }

  if (
    delta.kind !== "research_warning" ||
    typeof delta.detail !== "string" ||
    !message.researchProgress
  )
    return message;
  const warning = delta.detail.trim().slice(0, 320);
  const warnings = message.researchProgress.warnings ?? [];
  if (!warning || warnings.includes(warning)) return message;
  return {
    ...message,
    researchProgress: {
      ...message.researchProgress,
      warnings: [...warnings, warning].slice(-3),
    },
  };
}
