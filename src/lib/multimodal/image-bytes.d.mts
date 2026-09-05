export type ImageInfo = { width: number; height: number; alpha: boolean; contentType: string };
export function inspectImageBytes(
  bytes: Uint8Array,
  contentType: string,
  maxBytes?: number,
): ImageInfo;
export function validateImageResult(
  value: unknown,
  settings: { outputFormat: string; size: string },
): { imageUrl: string; info: ImageInfo };
