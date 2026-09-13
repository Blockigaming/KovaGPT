export const WORK_SITE_BUNDLE_SCHEMA: "kova-work-site-v1";
export const WORK_SITE_LIMITS: Readonly<{ files: number; fileBytes: number; bytes: number }>;
export type WorkSiteFile = { path: string; content: string };
export function compileWorkSiteBundle(value: unknown): Uint8Array;
export function parseWorkSiteBundle(bytes: Uint8Array): {
  title: string;
  files: WorkSiteFile[];
};
export function loadVerifiedWorkSiteOutput(
  dependencies: {
    readOutput(ownerId: string, outputId: string): Promise<Record<string, unknown> | null>;
    readProjectFile(ownerId: string, fileId: string): Promise<Record<string, unknown> | null>;
    download(path: string): Promise<Uint8Array | null>;
  },
  ownerId: string,
  outputId: string,
): Promise<{
  title: string;
  files: Array<{ path: string; type: string; base64: string; size: number; sha256: string }>;
  bytes: number;
  manifestSha256: string;
}>;
