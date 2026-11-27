import { developerInlineImage } from "./developer-responses-policy.mjs";

const prefix = "data:image/png;base64,";
export function developerImageEditValue(value) {
  try {
    return developerInlineImage({ type: "input_image", image_url: value, detail: "low" }).image_url;
  } catch {
    throw new Error("developer_image_invalid");
  }
}

export function developerImageEditBytes(value) {
  return Buffer.from(developerImageEditValue(value).slice(prefix.length), "base64");
}

// Reconstruct the quoted image from the actual multipart bytes, never from
// an independently supplied digest or a client-reported token count.
export function bindDeveloperImageInput(body, images) {
  if (
    !images ||
    Object.keys(images).some((key) => key !== "image" && key !== "mask") ||
    images.mask !== undefined ||
    images.image?.contentType !== "image/png" ||
    !(images.image.bytes instanceof Uint8Array) ||
    images.image.bytes.byteLength > 32768 ||
    Object.hasOwn(body, "image") ||
    Object.hasOwn(body, "mask")
  )
    throw new Error("developer_image_invalid");
  const image = developerImageEditValue(
    prefix + Buffer.from(images.image.bytes).toString("base64"),
  );
  return { ...body, image };
}
