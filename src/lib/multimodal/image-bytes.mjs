import { ImageInputError } from "./image-request-policy.mjs";
const fail = () => {
  throw new ImageInputError("The source image is invalid, too large, or unsupported.");
};
export function inspectImageBytes(bytes, contentType, maxBytes = 8 * 1024 * 1024) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12 || bytes.length > maxBytes) fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width,
    height,
    alpha = false;
  if (contentType === "image/png") {
    if (
      bytes.length < 33 ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) ||
      view.getUint32(8) !== 13 ||
      new TextDecoder().decode(bytes.subarray(12, 16)) !== "IHDR"
    )
      fail();
    width = view.getUint32(16);
    height = view.getUint32(20);
    alpha = bytes[25] === 4 || bytes[25] === 6;
    let hasPixels = false,
      ended = false;
    for (let offset = 8, count = 0; offset < bytes.length;) {
      if (++count > 4096 || offset + 12 > bytes.length) fail();
      const length = view.getUint32(offset);
      if (length > bytes.length - offset - 12) fail();
      const kind = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
      if (!/^[A-Za-z]{4}$/u.test(kind) || kind === "acTL") fail();
      if (kind === "IDAT" && length > 0) hasPixels = true;
      offset += length + 12;
      if (kind === "IEND") {
        if (length !== 0 || offset !== bytes.length) fail();
        ended = true;
        break;
      }
    }
    if (!hasPixels || !ended) fail();
  } else if (contentType === "image/jpeg") {
    if (
      bytes[0] !== 255 ||
      bytes[1] !== 216 ||
      bytes[2] !== 255 ||
      bytes[bytes.length - 2] !== 255 ||
      bytes[bytes.length - 1] !== 217
    )
      fail();
    let scan = false;
    for (let offset = 2, count = 0; offset + 4 < bytes.length && count++ < 8192;) {
      if (bytes[offset++] !== 255) fail();
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 218) {
        scan = true;
        break;
      }
      if (marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) fail();
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) fail();
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (length < 8) fail();
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
      }
      offset += length;
    }
    if (!scan) fail();
  } else if (contentType === "image/webp") {
    if (
      bytes.length < 25 ||
      new TextDecoder().decode(bytes.subarray(0, 4)) !== "RIFF" ||
      new TextDecoder().decode(bytes.subarray(8, 12)) !== "WEBP" ||
      view.getUint32(4, true) + 8 !== bytes.length
    )
      fail();
    const type = new TextDecoder().decode(bytes.subarray(12, 16));
    if (type === "VP8X" && bytes.length >= 30) {
      width = 1 + bytes[24] + bytes[25] * 256 + bytes[26] * 65536;
      height = 1 + bytes[27] + bytes[28] * 256 + bytes[29] * 65536;
      alpha = (bytes[20] & 16) !== 0;
    } else if (
      type === "VP8 " &&
      bytes.length >= 30 &&
      bytes[23] === 157 &&
      bytes[24] === 1 &&
      bytes[25] === 42
    ) {
      width = view.getUint16(26, true) & 16383;
      height = view.getUint16(28, true) & 16383;
    } else if (type === "VP8L" && bytes[20] === 47) {
      const bits = view.getUint32(21, true);
      width = (bits & 16383) + 1;
      height = ((bits >>> 14) & 16383) + 1;
      alpha = (bits & 268435456) !== 0;
    }
  } else fail();
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 8192 ||
    height > 8192 ||
    width * height > 25_000_000
  )
    fail();
  return { width, height, alpha, contentType };
}
export function validateImageResult(value, settings) {
  const item =
    value && typeof value === "object" && Array.isArray(value.data) && value.data.length === 1
      ? value.data[0]
      : null;
  const b64 = item?.b64_json;
  if (
    typeof b64 !== "string" ||
    b64.length > Math.ceil((8 * 1024 * 1024) / 3) * 4 ||
    b64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(b64)
  )
    fail();
  let binary;
  try {
    binary = atob(b64);
  } catch {
    fail();
  }
  if (btoa(binary) !== b64) fail();
  const bytes = Uint8Array.from(binary, (point) => point.charCodeAt(0));
  const mime = settings.outputFormat === "jpeg" ? "image/jpeg" : `image/${settings.outputFormat}`;
  const info = inspectImageBytes(bytes, mime);
  if (`${info.width}x${info.height}` !== settings.size) fail();
  return { imageUrl: `data:${mime};base64,${b64}`, info };
}
