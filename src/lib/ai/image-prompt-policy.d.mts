export const MAX_IMAGE_PROMPT_CHARS: 32000;

export function boundedImageProviderPrompt(
  prompt: string,
  workflowSkillBlock?: string,
): string | null;

export type ImageSheetKind = "animation" | "stickers";
export function imageSheetKind(prompt: string): ImageSheetKind | undefined;
export function imageSheetInstructions(kind: ImageSheetKind | undefined): string;
