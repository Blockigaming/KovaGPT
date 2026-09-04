export const MAX_PROJECT_FILE_BYTES: number;
export const MAX_PROJECT_FILE_NAME_CHARS: number;

export class ProjectFileInputError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string);
}

export function normalizeProjectFileName(value: unknown): string;

export function inspectProjectFile(input: {
  bytes: Uint8Array;
  fileName: unknown;
  requestedKind?: unknown;
}): {
  name: string;
  kind: "file" | "image";
  mimeType: string;
  extension: string;
};

export function readProjectFileBody(request: Request): Promise<Uint8Array>;
export function sha256Hex(bytes: Uint8Array): Promise<string>;
