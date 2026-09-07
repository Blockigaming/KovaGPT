import type { OriginalDocument, OriginalRecord } from "./library-original-policy.mjs";
export function publishOriginalLibraryDocument(
  admin: unknown,
  owner: string,
  input: Omit<OriginalDocument, "extension">,
  options: {
    storageLimit: number;
    expectedGeneration?: string;
    signal: AbortSignal;
    supabaseUrl: string;
    fetchImpl?: typeof fetch;
  },
): Promise<{ id: string; generation: string }>;
export function downloadOriginalLibraryDocument(
  admin: unknown,
  owner: string,
  id: string,
  generation: string,
  signal: AbortSignal,
  transport: { supabaseUrl: string; fetchImpl?: typeof fetch },
): Promise<{ row: OriginalRecord; bytes: Uint8Array }>;
export function deleteOriginalLibraryDocument(
  admin: unknown,
  owner: string,
  id: string,
  generation: string,
  signal: AbortSignal,
): Promise<{ ok: true }>;
