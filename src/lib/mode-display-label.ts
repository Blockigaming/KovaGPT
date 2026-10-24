import type { Mode } from "@/lib/modes";

/** Current plan/composer presentation only; legacy labels, IDs and prompts stay intact. */
export function modeDisplayLabel(mode: Pick<Mode, "id" | "label">): string {
  return mode.id === "instant" ? "Instant" : mode.label;
}
