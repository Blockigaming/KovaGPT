export function publishLibraryImageBytes(
  admin: unknown,
  owner: string,
  input: {
    id: string;
    bytes: Uint8Array;
    contentType: string;
    fingerprint: string;
    title: string;
    prompt?: string;
    source: string;
  },
  options: { signal: AbortSignal; supabaseUrl: string; fetchImpl?: typeof fetch },
): Promise<{ id: string }>;
export function deletePrivateLibraryImage(
  admin: unknown,
  owner: string,
  id: string,
  contentGeneration: string,
  signal: AbortSignal,
): Promise<boolean>;
export function sweepLibraryImageUploads(
  admin: unknown,
  owner: string | undefined,
  signal: AbortSignal,
): Promise<number>;
export function prepareLibraryImageAccountDeletion(
  admin: unknown,
  owner: string,
  signal: AbortSignal,
): Promise<boolean>;
