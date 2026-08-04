/** Authoritative graph algorithms. Durations are null until a task has factual timestamps. */
export function topologicalOrder(nodes, edges) {
  const ids = new Set(nodes.map((node) => node.id));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target))
      throw new Error("Edge references an unknown task");
    incoming.set(edge.target, incoming.get(edge.target) + 1);
    outgoing.get(edge.source).push(edge.target);
  }
  const ready = [...nodes.map((node) => node.id).filter((id) => incoming.get(id) === 0)].sort();
  const order = [];
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    for (const target of outgoing.get(id).sort()) {
      incoming.set(target, incoming.get(target) - 1);
      if (incoming.get(target) === 0) {
        ready.push(target);
        ready.sort();
      }
    }
  }
  if (order.length !== nodes.length) throw new Error("Dependency graph contains a cycle");
  return order;
}

export function calculateCriticalPath(nodes, edges) {
  const order = topologicalOrder(nodes, edges);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const predecessors = new Map(nodes.map((node) => [node.id, []]));
  const successors = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    predecessors.get(edge.target).push(edge.source);
    successors.get(edge.source).push(edge.target);
  }
  const earliest = new Map();
  const unknown = [];
  for (const id of order) {
    const duration = byId.get(id).durationMs;
    if (duration == null) unknown.push(id);
    const start = Math.max(0, ...predecessors.get(id).map((p) => earliest.get(p).finish));
    earliest.set(id, { start, finish: start + (duration ?? 0) });
  }
  const totalKnownDurationMs = Math.max(0, ...[...earliest.values()].map((value) => value.finish));
  const latest = new Map();
  for (const id of [...order].reverse()) {
    const duration = byId.get(id).durationMs ?? 0;
    const finish = successors.get(id).length
      ? Math.min(...successors.get(id).map((s) => latest.get(s).start))
      : totalKnownDurationMs;
    latest.set(id, { finish, start: finish - duration });
  }
  const tasks = order.map((id) => ({
    id,
    earliestStart: earliest.get(id).start,
    earliestFinish: earliest.get(id).finish,
    latestStart: latest.get(id).start,
    latestFinish: latest.get(id).finish,
    slack: latest.get(id).start - earliest.get(id).start,
    critical: byId.get(id).durationMs != null && latest.get(id).start === earliest.get(id).start,
  }));
  const criticalIds = new Set(tasks.filter((task) => task.critical).map((task) => task.id));
  return {
    order,
    tasks,
    criticalNodes: [...criticalIds],
    criticalEdges: edges
      .filter(
        (edge) =>
          criticalIds.has(edge.source) &&
          criticalIds.has(edge.target) &&
          earliest.get(edge.source).finish === earliest.get(edge.target).start,
      )
      .map((edge) => edge.id),
    totalKnownDurationMs,
    unknownDurationNodes: unknown,
    incomplete: unknown.length > 0,
    blockedCriticalPath: tasks
      .filter(
        (task) =>
          task.critical &&
          ["blocked", "failed", "approval_required"].includes(byId.get(task.id).status),
      )
      .map((task) => task.id),
  };
}

export function graphRelations(selected, edges) {
  const parents = new Map(),
    children = new Map();
  for (const edge of edges) {
    if (!parents.has(edge.target)) parents.set(edge.target, []);
    if (!children.has(edge.source)) children.set(edge.source, []);
    parents.get(edge.target).push(edge.source);
    children.get(edge.source).push(edge.target);
  }
  const walk = (map) => {
    const found = new Set(),
      queue = [...(map.get(selected) ?? [])];
    while (queue.length) {
      const id = queue.shift();
      if (found.has(id)) continue;
      found.add(id);
      queue.push(...(map.get(id) ?? []));
    }
    return found;
  };
  return {
    directPrerequisites: new Set(parents.get(selected) ?? []),
    prerequisites: walk(parents),
    directDependents: new Set(children.get(selected) ?? []),
    dependents: walk(children),
  };
}

export function dagLayout(nodes, edges, options = {}) {
  const direction = options.direction ?? "LR",
    spacing = options.compact ? { layer: 210, sibling: 110 } : { layer: 280, sibling: 160 };
  const order = topologicalOrder(nodes, edges),
    depth = new Map(order.map((id) => [id, 0]));
  for (const id of order)
    for (const edge of edges.filter((item) => item.source === id))
      depth.set(edge.target, Math.max(depth.get(edge.target), depth.get(id) + 1));
  const layers = new Map();
  for (const id of order) {
    const d = depth.get(id);
    if (!layers.has(d)) layers.set(d, []);
    layers.get(d).push(id);
  }
  const result = {};
  for (const [layer, ids] of layers)
    ids.sort().forEach((id, index) => {
      result[id] =
        direction === "TB"
          ? { x: index * spacing.sibling, y: layer * spacing.layer }
          : { x: layer * spacing.layer, y: index * spacing.sibling };
    });
  return result;
}
