import type { MemorySources } from "./memory-sources.mjs";
import type { InspectedMemorySource } from "./memory-sources.server.mjs";
export function createMemorySourceInspection(
  read: (input: MemorySources) => Promise<InspectedMemorySource[]>,
): {
  invalidate(): void;
  load(
    input: MemorySources,
  ): Promise<{ entries: InspectedMemorySource[]; error: string | null } | null>;
};
