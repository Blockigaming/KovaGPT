export type MemoryWritePrincipal = string | null | undefined;
export type MemoryWriteResult = "written" | "skipped";
export type MemoryDeleteResult = "deleted" | "skipped";

export function memoryWriteBlockStorageKey(principal: MemoryWritePrincipal): string | null;
export function isMemoryWriteBlocked(principal: MemoryWritePrincipal): boolean;
export function blockMemoryWrites(principal: MemoryWritePrincipal): void;
export function allowMemoryWrites(principal: MemoryWritePrincipal): void;

export function configureMemoryWrites(options: {
  principal: MemoryWritePrincipal;
  enabled: boolean;
}): { principal: string | null; enabled: boolean };

export function enqueueMemoryWrite(options: {
  principal: MemoryWritePrincipal;
  run: () => void | Promise<void>;
}): Promise<MemoryWriteResult>;

export function deleteSavedMemoryAfterDraining(options: {
  principal: MemoryWritePrincipal;
  run: () => void | Promise<void>;
}): Promise<MemoryDeleteResult>;

export function getMemoryWriteCoordinatorState(): {
  principal: string | null;
  enabled: boolean;
  deleting: string | null;
  generation: number;
};

export function resetMemoryWriteCoordinatorForTests(): void;
