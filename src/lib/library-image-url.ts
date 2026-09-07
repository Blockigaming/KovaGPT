import { safeImageUrl } from "./safe-image-url.ts";

type LibraryImageReference = {
  id: string;
  file_url: string | null;
};

type SignLibraryImage = (id: string) => Promise<{ url: string }>;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PRIVATE_LIBRARY_IMAGE_PATH = new RegExp(`^${UUID}/${UUID}\\.(?:png|jpe?g|webp|gif)$`, "i");

export function isPrivateLibraryImagePath(value: string | null | undefined): value is string {
  return typeof value === "string" && PRIVATE_LIBRARY_IMAGE_PATH.test(value);
}

/** Resolves public image URLs directly and private object paths through an authenticated signer. */
export async function resolveLibraryImageUrl(
  item: LibraryImageReference,
  signImage: SignLibraryImage,
): Promise<string | null> {
  const directUrl = safeImageUrl(item.file_url);
  if (directUrl) return directUrl;
  if (!isPrivateLibraryImagePath(item.file_url)) return null;

  const signed = await signImage(item.id);
  return safeImageUrl(signed.url);
}
