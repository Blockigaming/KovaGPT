/** A small, on-demand history read budget, shared across route remounts in this tab.
 * The server's owner-bound 90/minute limiter remains authoritative. List previews
 * use at most 20 of those reads, leaving room for the task list and editor.
 */
export const TASK_RUN_PAGE_SIZE = 10;
export const TASK_RUN_CACHE_TTL = 60_000;
export const TASK_RUN_CACHE_LIMIT = 100;
export const TASK_RUN_READ_LIMIT = 20;
const READ_WINDOW = 60_000;

export function createTaskRunReadBudget(now = Date.now) {
  let starts: number[] = [];
  return () => {
    const time = now();
    starts = starts.filter((started) => started > time - READ_WINDOW);
    if (starts.length >= TASK_RUN_READ_LIMIT) return starts[0] + READ_WINDOW;
    starts.push(time);
    return null;
  };
}

const reserveListRunRead = createTaskRunReadBudget();

export type TaskRunPreview =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "unavailable" }
  | { kind: "deferred"; retryAt: number }
  | { kind: "run"; status: unknown; at: string | null; summary: string | null };

export type TaskRunPageItem = {
  id: string;
  revision: number;
  updated_at: string;
  last_run_at: string | null;
};

export type TaskRunPageSnapshot = Record<string, TaskRunPreview>;
type Page = {
  owner: string;
  keys: Map<string, string>;
  queue: TaskRunPageItem[];
  states: TaskRunPageSnapshot;
  publish: (states: TaskRunPageSnapshot) => void;
};

/** Keeps only the current visible page queued, with two reads in flight. Canceling
 * cannot abort a server function already sent, but drops all remaining work and
 * ignores its result after an account/reset boundary. No timers or polling.
 */
export function createTaskRunPageReader(
  fetchRuns: (owner: string, taskId: string) => Promise<unknown>,
  reserveRead = reserveListRunRead,
  now = Date.now,
) {
  let owner: string | null = null;
  let epoch = 0;
  let page: Page | null = null;
  let active = 0;
  const pending = new Set<string>();
  const cache = new Map<string, { key: string; at: number; state: TaskRunPreview }>();
  const keyFor = (task: TaskRunPageItem, version: number) =>
    JSON.stringify([
      epoch,
      owner,
      task.id,
      task.revision,
      task.updated_at,
      task.last_run_at,
      version,
    ]);
  const publish = () => {
    if (page) page.publish({ ...page.states });
  };
  const readPreview = (rows: unknown): TaskRunPreview => {
    if (!Array.isArray(rows)) return { kind: "unavailable" };
    if (rows.length === 0) return { kind: "empty" };
    // The endpoint orders newest scheduled_for first. Never use task.status or
    // result prose as evidence of execution status, and never reorder this page.
    const run = rows[0];
    if (!run || typeof run !== "object") return { kind: "unavailable" };
    return {
      kind: "run",
      status: run.status,
      at:
        typeof run.started_at === "string"
          ? run.started_at
          : typeof run.scheduled_for === "string"
            ? run.scheduled_for
            : null,
      summary: typeof run.result_summary === "string" ? run.result_summary : null,
    };
  };
  const pump = () => {
    while (page && active < 2 && page.queue.length) {
      const task = page.queue.shift()!;
      const key = page.keys.get(task.id)!;
      if (pending.has(key)) continue;
      const retryAt = reserveRead();
      if (retryAt !== null) {
        page.states[task.id] = { kind: "deferred", retryAt };
        publish();
        continue;
      }
      const readOwner = page.owner;
      const readEpoch = epoch;
      active += 1;
      pending.add(key);
      // Promise.resolve also handles synchronous transport failures as unavailable.
      void Promise.resolve()
        .then(() => fetchRuns(readOwner, task.id))
        .then(readPreview, (): TaskRunPreview => ({ kind: "unavailable" }))
        .then((state) => {
          if (owner !== readOwner || epoch !== readEpoch) return;
          cache.delete(task.id);
          cache.set(task.id, { key, at: now(), state });
          while (cache.size > TASK_RUN_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
          if (page?.owner === readOwner && page.keys.get(task.id) === key) {
            page.states[task.id] = state;
            publish();
          }
        })
        .finally(() => {
          active -= 1;
          pending.delete(key);
          pump();
        });
    }
  };

  return {
    reset() {
      epoch += 1;
      owner = null;
      page = null;
      cache.clear();
    },
    loadPage(
      expectedUserId: string,
      tasks: TaskRunPageItem[],
      version: number,
      onChange: (states: TaskRunPageSnapshot) => void,
    ) {
      if (owner !== expectedUserId) {
        epoch += 1;
        owner = expectedUserId;
        cache.clear();
      }
      const next: Page = {
        owner: expectedUserId,
        keys: new Map(),
        queue: [],
        states: {},
        publish: onChange,
      };
      // Defense in depth: callers cannot accidentally fan out over the whole list.
      for (const task of tasks.slice(0, TASK_RUN_PAGE_SIZE)) {
        const key = keyFor(task, version);
        next.keys.set(task.id, key);
        const cached = cache.get(task.id);
        if (cached?.key === key && now() - cached.at < TASK_RUN_CACHE_TTL) {
          next.states[task.id] = cached.state;
        } else {
          next.states[task.id] = { kind: "loading" };
          next.queue.push(task);
        }
      }
      page = next;
      publish();
      pump();
      return () => {
        if (page === next) page = null;
      };
    },
  };
}
