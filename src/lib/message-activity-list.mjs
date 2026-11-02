// Keep each operation in arrival order; only its own status updates replace a row.
export function appendMessageActivity(current, next) {
  let match = -1;
  if (next.activityId) {
    match = current.findIndex((item) => item.activityId === next.activityId);
  } else {
    // Legacy streams omit IDs. Match a live operation by label first; a terminal
    // label may differ only when there is one unambiguous live operation.
    const running = current
      .map((item, index) => ({ item, index }))
      .filter(
        ({ item }) => !item.activityId && item.tool === next.tool && item.status === "running",
      );
    match =
      running
        .slice()
        .reverse()
        .find(({ item }) => item.label === next.label)?.index ?? -1;
    if (match < 0 && next.status !== "running" && running.length === 1) match = running[0].index;
  }
  if (match < 0) return [...current, next];
  return current.map((item, index) => (index === match ? { ...item, ...next } : item));
}
