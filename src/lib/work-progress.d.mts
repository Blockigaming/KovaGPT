import type { WorkRun } from "./work-execution-protocol.mjs";
import type { Activity } from "./chat-store";
export function publicWorkActivity(
  run: WorkRun,
  kind: string,
  detail?: Record<string, unknown>,
): Activity | undefined;
