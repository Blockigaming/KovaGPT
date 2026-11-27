export function developerImageEditValue(value: unknown): string;
export function developerImageEditBytes(value: unknown): Uint8Array;
export function bindDeveloperImageInput(
  body: Record<string, unknown>,
  images: {
    image: { bytes: Uint8Array; contentType: string };
    mask?: { bytes: Uint8Array; contentType: string };
  },
): Record<string, unknown>;
