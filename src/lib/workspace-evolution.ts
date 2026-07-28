export type EvolutionItem = {
  id: string;
  kind: string;
  updatedAt: string;
  status?: string;
  projectId?: string;
};

export type WorkspaceSnapshot = {
  id: string;
  createdAt: string;
  label: string;
  entries: EvolutionItem[];
};

const snapshotKey = (scope: string) => `kova-workspace-snapshots-v1:${scope}`;
const MAX_SNAPSHOTS = 12;
const MAX_ENTRIES = 250;

export function loadWorkspaceSnapshots(scope: string): WorkspaceSnapshot[] {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(snapshotKey(scope)) ?? "[]",
    ) as WorkspaceSnapshot[];
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (snapshot) => snapshot?.id && snapshot?.createdAt && Array.isArray(snapshot.entries),
          )
          .slice(0, MAX_SNAPSHOTS)
      : [];
  } catch {
    return [];
  }
}

export function captureWorkspaceSnapshot(
  scope: string,
  items: EvolutionItem[],
  label = `Snapshot ${new Date().toLocaleDateString()}`,
): WorkspaceSnapshot[] {
  const snapshot: WorkspaceSnapshot = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    label: label.trim().slice(0, 80) || "Workspace snapshot",
    // Store relationship metadata only. Titles and content are deliberately omitted;
    // replay resolves against the user's currently authorized workspace inventory.
    entries: items.slice(0, MAX_ENTRIES).map(({ id, kind, updatedAt, status, projectId }) => ({
      id,
      kind,
      updatedAt,
      status,
      projectId,
    })),
  };
  const next = [snapshot, ...loadWorkspaceSnapshots(scope)].slice(0, MAX_SNAPSHOTS);
  localStorage.setItem(snapshotKey(scope), JSON.stringify(next));
  return next;
}

export function removeWorkspaceSnapshot(scope: string, id: string): WorkspaceSnapshot[] {
  const next = loadWorkspaceSnapshots(scope).filter((snapshot) => snapshot.id !== id);
  localStorage.setItem(snapshotKey(scope), JSON.stringify(next));
  return next;
}

export function workspaceHealth(items: EvolutionItem[], now = Date.now()) {
  const active = items.filter(
    (item) =>
      item.kind === "work" ||
      (item.kind === "research" &&
        !["complete", "failed", "cancelled"].includes(item.status ?? "")) ||
      (item.kind === "automation" &&
        ["scheduled", "running", "paused"].includes(item.status ?? "")),
  );
  const stalled = active.filter((item) => now - Date.parse(item.updatedAt) > 14 * 86_400_000);
  const recent = items.filter((item) => now - Date.parse(item.updatedAt) <= 30 * 86_400_000);
  const types = new Set(recent.map((item) => item.kind));
  const score = Math.max(0, Math.min(100, 100 - stalled.length * 12 - (recent.length ? 0 : 25)));
  return {
    score,
    active: active.length,
    stalled,
    recent: recent.length,
    representedTypes: types.size,
  };
}

export function workspaceDna(items: EvolutionItem[], now = Date.now()) {
  const summarize = (from: number, to: number) => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const age = now - Date.parse(item.updatedAt);
      if (age >= from && age < to) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    }
    return counts;
  };
  const current = summarize(0, 30 * 86_400_000);
  const previous = summarize(30 * 86_400_000, 60 * 86_400_000);
  return [...new Set([...current.keys(), ...previous.keys()])]
    .map((kind) => ({ kind, current: current.get(kind) ?? 0, previous: previous.get(kind) ?? 0 }))
    .sort((a, b) => b.current - a.current || b.previous - a.previous);
}
