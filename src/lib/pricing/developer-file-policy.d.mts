export type FileBinding = { id: string; digest: string };
export function developerFileReferences(
  kind: string,
  input: unknown,
): { body: Record<string, unknown>; ids: string[] };
export function developerFileUpload(input: unknown): {
  filename: string;
  mimeType: string;
  text: string;
};
export function expandDeveloperFileContent(
  body: Record<string, unknown>,
  files: Record<string, unknown>[],
  now?: number,
): { body: Record<string, unknown>; bindings: FileBinding[]; expiresAt: number | null };
