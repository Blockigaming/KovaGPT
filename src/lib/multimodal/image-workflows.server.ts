import { imageModel } from "@/lib/ai/provider.server";
import { selectModelForMode, KovaProviderError } from "@/lib/ai/registry.server";

export type ImageOperation = "generate" | "variation" | "edit";
export type ImageAspectRatio = "1:1" | "2:3" | "3:2" | "16:9" | "9:16";
export type ImageQuality = "low" | "medium" | "high";
export type ImageOutputFormat = "png" | "jpeg" | "webp";

export type ImageGenerationSettings = {
  prompt: string;
  operation: ImageOperation;
  aspectRatio: ImageAspectRatio;
  size: "1024x1024" | "1024x1536" | "1536x1024" | "1792x1024";
  quality: ImageQuality;
  outputFormat: ImageOutputFormat;
  transparentBackground: boolean;
  n: 1 | 2 | 4;
  parentImageId?: string;
  editInstruction?: string;
  maskAssetId?: string;
  sourceChatId?: string;
  projectId?: string;
};

export type ImageResultMetadata = {
  prompt: string;
  createdAt: string;
  dimensions: string;
  aspectRatio: ImageAspectRatio;
  quality: ImageQuality;
  outputFormat: ImageOutputFormat;
  operation: ImageOperation;
  modelLabel: string;
  sourceChatId?: string;
  projectId?: string;
  parentImageId?: string;
  editInstruction?: string;
};

const ASPECT_TO_SIZE: Record<ImageAspectRatio, ImageGenerationSettings["size"]> = {
  "1:1": "1024x1024",
  "2:3": "1024x1536",
  "3:2": "1536x1024",
  "16:9": "1792x1024",
  "9:16": "1024x1536",
};

export function sanitizeImagePrompt(prompt: string): string {
  return prompt
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

export function normalizeImageSettings(
  input: Partial<ImageGenerationSettings> & { prompt?: string },
): ImageGenerationSettings {
  const prompt = sanitizeImagePrompt(input.prompt ?? "");
  if (!prompt)
    throw new KovaProviderError("INVALID_PROVIDER_RESPONSE", "Image prompt is required.", {
      status: 400,
    });
  const aspectRatio = input.aspectRatio ?? "1:1";
  const operation = input.operation ?? "generate";
  if (operation !== "generate" && !input.parentImageId) {
    throw new KovaProviderError(
      "CAPABILITY_UNSUPPORTED",
      "Image edit or variation requires a parent image.",
      { status: 400 },
    );
  }
  return {
    prompt,
    operation,
    aspectRatio,
    size: input.size ?? ASPECT_TO_SIZE[aspectRatio],
    quality: input.quality ?? "low",
    outputFormat: input.outputFormat ?? "png",
    transparentBackground: Boolean(input.transparentBackground),
    n: input.n ?? 1,
    parentImageId: input.parentImageId,
    editInstruction: sanitizeImagePrompt(input.editInstruction ?? "") || undefined,
    maskAssetId: input.maskAssetId,
    sourceChatId: input.sourceChatId,
    projectId: input.projectId,
  };
}

export function imageProviderPayload(settings: ImageGenerationSettings) {
  const selected = selectModelForMode("image");
  const prompt =
    settings.operation === "generate"
      ? settings.prompt
      : `${settings.operation === "variation" ? "Create a faithful variation of" : "Edit"} the referenced image. User instruction: ${settings.editInstruction ?? settings.prompt}`;
  return {
    model: selected.model.modelId || imageModel(),
    prompt,
    size: settings.size,
    quality: settings.quality,
    n: settings.n,
    ...(settings.transparentBackground && settings.outputFormat === "png"
      ? { background: "transparent" }
      : {}),
  };
}

export function imageResultMetadata(
  settings: ImageGenerationSettings,
  modelLabel = "Kova Image",
): ImageResultMetadata {
  return {
    prompt: settings.prompt,
    createdAt: new Date().toISOString(),
    dimensions: settings.size,
    aspectRatio: settings.aspectRatio,
    quality: settings.quality,
    outputFormat: settings.outputFormat,
    operation: settings.operation,
    modelLabel,
    sourceChatId: settings.sourceChatId,
    projectId: settings.projectId,
    parentImageId: settings.parentImageId,
    editInstruction: settings.editInstruction,
  };
}

export function imageActionSet(capabilities: { edit: boolean; variation: boolean }) {
  return [
    "open",
    "expand",
    "download",
    "save_to_library",
    "add_to_project",
    "use_in_new_chat",
    "copy_prompt",
    "retry_generation",
    ...(capabilities.variation ? ["generate_variation"] : []),
    ...(capabilities.edit ? ["edit_image", "compare_original"] : []),
    "delete_authorized",
    "view_metadata",
  ];
}
