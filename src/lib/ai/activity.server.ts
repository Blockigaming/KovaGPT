import { replaceControlCharacters } from "@/lib/sanitize-text";
export type ToolActivityType =
  | "search_web"
  | "read_source"
  | "project_files"
  | "memory"
  | "research_plan"
  | "compare_sources"
  | "write_report"
  | "image_generation"
  | "data_analysis"
  | "gmail"
  | "calendar"
  | "drive"
  | "email_draft"
  | "scheduled_task"
  | "upload_file"
  | "process_document"
  | "read_pdf"
  | "inspect_spreadsheet"
  | "analyze_image"
  | "profile_dataset"
  | "generate_chart"
  | "create_artifact"
  | "edit_image"
  | "save_to_library"
  | "connector_tool"
  | "gmail_search"
  | "gmail_read"
  | "gmail_draft"
  | "gmail_send"
  | "calendar_check"
  | "calendar_write"
  | "drive_search"
  | "drive_read"
  | "notification"
  | "share_link"
  | "billing"
  | "audit";

export type ToolActivityStatus = "pending" | "running" | "complete" | "failed" | "canceled";

export type ToolActivityEvent = {
  id: string;
  type: ToolActivityType;
  label: string;
  status: ToolActivityStatus;
  timestamp: string;
  parentId?: string;
  metadata?: Record<string, string | number | boolean>;
};

let activityCounter = 0;

export function createToolActivityEvent(
  type: ToolActivityType,
  label: string,
  status: ToolActivityStatus = "pending",
  options: { parentId?: string; metadata?: Record<string, string | number | boolean> } = {},
): ToolActivityEvent {
  activityCounter += 1;
  return {
    id: `act-${Date.now().toString(36)}-${activityCounter.toString(36)}`,
    type,
    label: replaceControlCharacters(label).slice(0, 160),
    status,
    timestamp: new Date().toISOString(),
    ...(options.parentId ? { parentId: options.parentId } : {}),
    ...(options.metadata ? { metadata: scrubActivityMetadata(options.metadata) } : {}),
  };
}

export function scrubActivityMetadata(
  metadata: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (/token|secret|key|password|credential|authorization/i.test(key)) continue;
    safe[key] = typeof value === "string" ? value.slice(0, 240) : value;
  }
  return safe;
}

export function activityToSseDelta(event: ToolActivityEvent) {
  return {
    kind: "activity",
    activity_id: event.id,
    tool: event.type,
    label: event.label,
    status: event.status,
    timestamp: event.timestamp,
    ...(event.parentId ? { parent_id: event.parentId } : {}),
    ...(event.metadata ? { metadata: event.metadata } : {}),
  };
}
