export type ImageAdjustments = { brightness: number; contrast: number; saturation: number };
export const DEFAULT_IMAGE_ADJUSTMENTS: ImageAdjustments;
export function adjustImagePixels(
  source: Uint8ClampedArray,
  settings: ImageAdjustments,
): Uint8ClampedArray;
