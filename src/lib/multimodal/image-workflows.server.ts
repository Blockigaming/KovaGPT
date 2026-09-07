import { imageModel } from "@/lib/ai/provider.server";
import { selectModelForMode } from "@/lib/ai/registry.server";
import { replaceControlCharacters } from "@/lib/sanitize-text";

import { getAiProviderConfig } from "@/lib/ai/provider.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import {
  normalizeImageRequest,
  imageRequestFields,
  ImageInputError,
  type ImageSettings,
} from "./image-request-policy.mjs";

export type ImageGenerationSettings = ImageSettings;
export type ImageOperation = ImageSettings["operation"];
export type ImageAspectRatio = ImageSettings["aspectRatio"];
export type ImageQuality = ImageSettings["quality"];
export type ImageOutputFormat = ImageSettings["outputFormat"];

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

export function imageEditingEnabled() {
  return (
    runtimeEnv("KOVA_IMAGE_EDITS_ENABLED") === "true" &&
    /^gpt-image-(?:1(?:\.5|-mini)?|2)$/u.test(imageModel())
  );
}
export function sanitizeImagePrompt(prompt: string): string {
  return replaceControlCharacters(prompt).replace(/\s+/g, " ").trim();
}
export function normalizeImageSettings(input: unknown): ImageGenerationSettings {
  return normalizeImageRequest(input, {
    provider: getAiProviderConfig().provider,
    editEnabled: imageEditingEnabled(),
  });
}
export function imageProviderPayload(settings: ImageGenerationSettings) {
  if (settings.operation !== "generate" || settings.parentImageId || settings.maskAssetId)
    throw new ImageInputError("Source images require the authenticated image-edit transport.");
  return imageRequestFields(settings, selectModelForMode("image").model.modelId || imageModel());
}
export function imageEditProviderPayload(settings: ImageGenerationSettings) {
  if (!imageEditingEnabled() || settings.operation !== "edit" || !settings.parentImageId)
    throw new ImageInputError("Image editing is not enabled.", 503);
  return imageRequestFields(settings, selectModelForMode("image").model.modelId || imageModel());
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

    ...(capabilities.edit ? ["edit_image", "compare_original"] : []),
    "delete_authorized",
    "view_metadata",
  ];
}
