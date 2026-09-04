import { safeNavigationUrl } from "./safe-url.ts";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// Base64 expands bytes by at most 4/3. Leave room for the data URL prefix.
export const MAX_SAFE_IMAGE_DATA_URL_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64;

const SAFE_IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/]+={0,2}$/i;

/** Returns only web, same-origin, or inert raster data URLs suitable for an img element. */
export function safeImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_SAFE_IMAGE_DATA_URL_CHARS) return null;
  if (trimmed.startsWith("data:")) {
    return SAFE_IMAGE_DATA_URL.test(trimmed) ? trimmed : null;
  }
  return safeNavigationUrl(trimmed);
}
