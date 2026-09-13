export const MAX_IMAGE_PROMPT_CHARS = 32_000;

export function boundedImageProviderPrompt(prompt, workflowSkillBlock = "") {
  if (typeof prompt !== "string" || typeof workflowSkillBlock !== "string") return null;
  const combined = prompt + workflowSkillBlock;
  return combined.length <= MAX_IMAGE_PROMPT_CHARS ? combined : null;
}
