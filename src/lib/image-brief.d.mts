export type ImageBrief = {
  prompt: string;
  aspectRatio: "1:1" | "2:3" | "3:2";
  inspiration: string;
};
export const EMPTY_IMAGE_BRIEF: ImageBrief;
export function isImageBrief(value: unknown): value is ImageBrief;
export function replaceImageBrief(
  before: ImageBrief,
  suggestion: { prompt: string; label: string },
): ImageBrief;
export function undoImageBrief(
  current: ImageBrief,
  operation: { before: ImageBrief; after: ImageBrief },
): ImageBrief;
