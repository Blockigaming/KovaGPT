import { activityHostname } from "../activity-display.mjs";
// Explicit public tool statuses only. Reasoning deltas and arguments are never
// copied into progress, even if a provider sends them alongside tool events.
export function providerActivityDeltas(event) {
  const rows = [];
  const emit = (id, tool, label, status, hostname) =>
    rows.push({
      kind: "activity",
      activity_id: `provider-${id}`,
      tool,
      label,
      status,
      ...(hostname ? { hostname } : {}),
    });
  if (
    /^response\.(web_search_call|file_search_call|code_interpreter_call)\.(in_progress|searching|interpreting|completed)$/.test(
      event.type,
    )
  ) {
    const tool = event.type.includes("web_search")
      ? "search_web"
      : event.type.includes("file_search")
        ? "project_files"
        : "data_analysis";
    const done = event.type.endsWith(".completed");
    const label =
      tool === "search_web"
        ? done
          ? "Web search completed"
          : "Searching the web…"
        : tool === "project_files"
          ? done
            ? "File search completed"
            : "Finding references in files…"
          : done
            ? "Analysis completed"
            : "Analyzing data…";
    emit(
      String(event.item_id ?? event.output_index ?? "tool").slice(0, 160),
      tool,
      label,
      done ? "done" : "running",
    );
  }
  if (!["response.output_item.added", "response.output_item.done"].includes(event.type))
    return rows;
  const item = event.item;
  if (item?.type !== "web_search_call") return rows;
  const done = event.type === "response.output_item.done" && item.status === "completed";
  const failed = item.status === "failed";
  const id = String(item.id ?? event.output_index ?? "web").slice(0, 160);
  const action = item.action;
  const hostname = activityHostname(action?.url);
  if (hostname && ["open_page", "find_in_page"].includes(action?.type)) {
    const verb =
      action.type === "open_page" ? (done ? "Opened" : "Opening") : done ? "Read" : "Reading";
    emit(
      id,
      "read_source",
      failed ? `Could not read ${hostname}` : `${verb} ${hostname}${done ? "" : "…"}`,
      failed ? "failed" : done ? "done" : "running",
      hostname,
    );
  }
  if (done && action?.type === "search" && Array.isArray(action.sources)) {
    for (const [index, source] of action.sources.entries()) {
      const host = activityHostname(source?.url);
      if (host)
        emit(`${id}-source-${index}`, "read_source", `Found a source on ${host}`, "done", host);
    }
  }
  return rows;
}
