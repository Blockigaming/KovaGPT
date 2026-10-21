import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listScheduledTaskRuns } from "@/lib/scheduled-tasks.functions";
import {
  createTaskRunPageReader,
  type TaskRunPageItem,
  type TaskRunPageSnapshot,
} from "@/lib/scheduled-task-run-page";

const EMPTY_PREVIEWS: TaskRunPageSnapshot = {};

export function useScheduledTaskRunPreviews(
  userKey: string | null,
  enabled: boolean,
  lifecycleVersion: number,
  refreshVersion: number,
  visibleTasks: TaskRunPageItem[],
) {
  const listRuns = useServerFn(listScheduledTaskRuns);
  const listRef = useRef(listRuns);
  listRef.current = listRuns;
  const [reader] = useState(() =>
    createTaskRunPageReader((owner, taskId) =>
      listRef.current({ data: { expectedUserId: owner, taskId } }),
    ),
  );
  const scope = JSON.stringify([userKey, lifecycleVersion]);
  const key = JSON.stringify([
    scope,
    enabled,
    refreshVersion,
    visibleTasks.map(({ id, revision, updated_at, last_run_at }) => [
      id,
      revision,
      updated_at,
      last_run_at,
    ]),
  ]);
  const [snapshot, setSnapshot] = useState<{ key: string; states: TaskRunPageSnapshot } | null>(
    null,
  );

  useEffect(() => {
    reader.reset();
    return () => reader.reset();
  }, [reader, scope]);

  useEffect(() => {
    if (!enabled || !userKey) return;
    return reader.loadPage(userKey, visibleTasks, refreshVersion, (states) =>
      setSnapshot({ key, states }),
    );
  }, [enabled, key, reader, refreshVersion, scope, userKey, visibleTasks]);

  // Gate during render, before effects: an old account/page must never flash.
  return snapshot?.key === key ? snapshot.states : EMPTY_PREVIEWS;
}
