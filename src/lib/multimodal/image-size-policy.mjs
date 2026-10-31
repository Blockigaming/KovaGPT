export const IMAGE_SHAPES = Object.freeze([
  { id: "1:1", label: "Square", size: "1024x1024" },
  { id: "3:2", label: "Landscape", size: "1536x1024" },
  { id: "2:3", label: "Portrait", size: "1024x1536" },
  { id: "16:9", label: "Widescreen", size: "1536x864" },
  { id: "9:16", label: "Story", size: "864x1536" },
]);
export function validCustomImageSize(size) {
  if (typeof size !== "string" || !/^\d{3,4}x\d{3,4}$/u.test(size)) return false;
  const [width, height] = size.split("x").map(Number);
  return (
    width % 16 === 0 &&
    height % 16 === 0 &&
    width <= 3840 &&
    height <= 3840 &&
    width / height >= 1 / 3 &&
    width / height <= 3 &&
    width * height >= 655360 &&
    width * height <= 8294400
  );
}
export function supportsCustomImageSizes(model) {
  return /^gpt-image-(?:2(?:-\d{4}-\d{2}-\d{2})?|2\.5-(?:flare|sunburst)(?:-\d{4}-\d{2}-\d{2})?)$/u.test(
    model ?? "",
  );
}
export function supportsImageEdits(model) {
  return (
    supportsCustomImageSizes(model) ||
    /^(?:gpt-image-1(?:\.5|-mini)?|chatgpt-image-latest)$/u.test(model ?? "")
  );
}
