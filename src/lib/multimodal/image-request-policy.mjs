export class ImageInputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const SIZES = { "1:1": "1024x1024", "2:3": "1024x1536", "3:2": "1536x1024" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
function prompt(value) {
  if (typeof value !== "string" || value.length > 2000)
    throw new ImageInputError("Image instructions must be text up to 2,000 characters.");
  const cleaned = Array.from(value)
    .filter((point) => point.codePointAt(0) >= 32 || point === "\n" || point === "\t")
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned) throw new ImageInputError("Image instructions are required.");
  return cleaned;
}
export function normalizeImageRequest(
  input,
  { provider = "azure_openai", editEnabled = false } = {},
) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ImageInputError("Invalid image settings.");
  const allowed = new Set([
    "prompt",
    "operation",
    "aspectRatio",
    "size",
    "quality",
    "outputFormat",
    "transparentBackground",
    "n",
    "parentImageId",
    "editInstruction",
    "maskAssetId",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key)))
    throw new ImageInputError("Unsupported image settings.");
  const operation = input.operation ?? "generate";
  if (operation !== "generate" && operation !== "edit")
    throw new ImageInputError(
      "Image variations are not supported. Use an explicit image edit instead.",
    );
  if (operation === "edit" && !editEnabled)
    throw new ImageInputError(
      "Image editing is not enabled. Your original image has not been changed.",
      503,
    );
  if (operation === "edit" && !UUID.test(input.parentImageId ?? ""))
    throw new ImageInputError("Choose an image from your Library to edit.");
  if (input.maskAssetId !== undefined && (!UUID.test(input.maskAssetId) || operation !== "edit"))
    throw new ImageInputError("A mask requires a supported image edit and a Library PNG.");
  if (
    operation === "generate" &&
    (input.parentImageId !== undefined || input.editInstruction !== undefined)
  )
    throw new ImageInputError("A source image requires the image-edit operation.");
  const aspectRatio = input.aspectRatio ?? "1:1";
  if (!Object.hasOwn(SIZES, aspectRatio))
    throw new ImageInputError(
      "Choose square (1:1), portrait (2:3), or landscape (3:2). Exact 16:9 and 9:16 output is unsupported.",
    );
  const size = SIZES[aspectRatio];
  if (input.size !== undefined && input.size !== size)
    throw new ImageInputError("Image size must match the supported aspect ratio.");
  const quality = input.quality ?? "low",
    outputFormat = input.outputFormat ?? "png";
  if (!["low", "medium", "high"].includes(quality))
    throw new ImageInputError("Unsupported image quality.");
  if (!["png", "jpeg", ...(provider === "openai" ? ["webp"] : [])].includes(outputFormat))
    throw new ImageInputError("This image provider supports PNG or JPEG output.");
  if (input.n !== undefined && input.n !== 1)
    throw new ImageInputError("One image is supported per request.");
  if (input.transparentBackground !== undefined && typeof input.transparentBackground !== "boolean")
    throw new ImageInputError("Invalid background setting.");
  if (input.transparentBackground && outputFormat === "jpeg")
    throw new ImageInputError("Transparent output requires PNG.");
  const instruction = prompt(
    operation === "edit" ? (input.editInstruction ?? input.prompt) : input.prompt,
  );
  return {
    prompt: instruction,
    operation,
    aspectRatio,
    size,
    quality,
    outputFormat,
    transparentBackground: input.transparentBackground === true,
    n: 1,
    ...(operation === "edit"
      ? {
          parentImageId: input.parentImageId,
          editInstruction: instruction,
          ...(input.maskAssetId ? { maskAssetId: input.maskAssetId } : {}),
        }
      : {}),
  };
}
export function imageRequestFields(settings, model) {
  return {
    model,
    prompt: settings.prompt,
    size: settings.size,
    quality: settings.quality,
    output_format: settings.outputFormat,
    n: 1,
    ...(settings.transparentBackground ? { background: "transparent" } : {}),
  };
}
