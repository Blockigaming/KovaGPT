export class ImageInputError extends Error {
  status: number;
  constructor(message: string, status?: number);
}
export type ImageSettings = {
  prompt: string;
  operation: "generate" | "edit";
  aspectRatio: "1:1" | "2:3" | "3:2" | "16:9" | "9:16" | "custom";
  size: string;
  quality: "low" | "medium" | "high";
  outputFormat: "png" | "jpeg" | "webp";
  transparentBackground: boolean;
  n: 1;
  parentImageId?: string;
  editInstruction?: string;
  maskAssetId?: string;
};
export function normalizeImageRequest(
  input: unknown,
  options?: {
    provider?: "openai" | "azure_openai";
    editEnabled?: boolean;
    customSizesSupported?: boolean;
  },
): ImageSettings;
export function imageRequestFields(
  settings: ImageSettings,
  model: string,
): {
  model: string;
  prompt: string;
  size: string;
  quality: string;
  output_format: string;
  n: number;
  background?: string;
};
