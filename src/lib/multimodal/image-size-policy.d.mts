export type ImageShape = "1:1" | "3:2" | "2:3" | "16:9" | "9:16" | "custom";
export const IMAGE_SHAPES: readonly {
  id: Exclude<ImageShape, "custom">;
  label: string;
  size: string;
}[];
export function validCustomImageSize(size: unknown): boolean;
export function supportsCustomImageSizes(model: unknown): boolean;
export function supportsImageEdits(model: unknown): boolean;
