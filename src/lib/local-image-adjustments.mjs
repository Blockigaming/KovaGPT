export const DEFAULT_IMAGE_ADJUSTMENTS = Object.freeze({
  brightness: 0,
  contrast: 0,
  saturation: 100,
});
export function adjustImagePixels(source, settings) {
  if (!(source instanceof Uint8ClampedArray) || source.length % 4 || source.length > 16000000 * 4)
    throw new Error("Image dimensions exceed the local editor limit.");
  const { brightness, contrast, saturation } = settings;
  if (
    ![brightness, contrast, saturation].every(Number.isFinite) ||
    Math.abs(brightness) > 100 ||
    Math.abs(contrast) > 100 ||
    saturation < 0 ||
    saturation > 200
  )
    throw new Error("Invalid image adjustments.");
  const output = new Uint8ClampedArray(source),
    c = contrast * 2.55,
    factor = (259 * (c + 255)) / (255 * (259 - c));
  for (let i = 0; i < source.length; i += 4) {
    const gray = 0.2126 * source[i] + 0.7152 * source[i + 1] + 0.0722 * source[i + 2];
    for (let j = 0; j < 3; j++)
      output[i + j] =
        factor * (gray + ((source[i + j] - gray) * saturation) / 100 - 128) +
        128 +
        brightness * 2.55;
  }
  return output;
}
