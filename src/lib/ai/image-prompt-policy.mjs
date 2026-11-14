export const MAX_IMAGE_PROMPT_CHARS = 32_000;

export function boundedImageProviderPrompt(prompt, workflowSkillBlock = "") {
  if (typeof prompt !== "string" || typeof workflowSkillBlock !== "string") return null;
  const combined = prompt + workflowSkillBlock;
  return combined.length <= MAX_IMAGE_PROMPT_CHARS ? combined : null;
}

const animatedRequest = /\b(?:animated\s+(?:gif|sticker)|looping\s+gif|gif)\b/i;
const stickerPackRequest = /\bsticker\s+(?:pack|sheet|set)\b/i;

export function imageSheetKind(prompt) {
  if (animatedRequest.test(prompt)) return "animation";
  if (stickerPackRequest.test(prompt)) return "stickers";
  return undefined;
}

export function imageSheetInstructions(kind) {
  if (!kind) return "";
  const cells =
    kind === "animation"
      ? "Show eight successive frames of the same subject, in reading order, with stable framing and consistent color. Finish in a pose that flows back into frame one."
      : "Draw a coordinated pack of eight different stickers, one isolated sticker centered per cell. Give each sticker clear separation from its neighbors.";
  return (
    "\n\nOutput a single evenly spaced 4-column by 2-row sprite sheet (eight equally sized cells), with no gutters, grid lines, captions, or extra margins. Keep all artwork within its own cell. " +
    cells
  );
}
