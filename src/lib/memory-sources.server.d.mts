import type { MemorySourceRef } from "./memory-sources.mjs";
export type InspectedMemorySource = MemorySourceRef &
  (
    | { available: false }
    | {
        available: true;
        title: string;
        content: string;
        truncated: boolean;
        updatedAt: string | null;
      }
  );
export function inspectMemorySources(
  supabase: unknown,
  userId: string,
  input: { ownerId: string; sources: MemorySourceRef[] },
): Promise<InspectedMemorySource[]>;
