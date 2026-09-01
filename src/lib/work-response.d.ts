declare module "@/lib/work-response.mjs" {
  import type { WorkRun } from "@/lib/work.functions";

  export function parseWorkRunList(value: unknown): WorkRun[];
}
