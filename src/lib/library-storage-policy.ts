import { isPrivateLibraryImagePath } from "./library-image-url.ts";

type StorageRemovalResult = {
  error: { message?: string | null } | null;
};

/**
 * Removes a KovaGPT-managed private image before its Library metadata is
 * deleted. Public/legacy URLs have no object in this bucket and are skipped.
 */
export async function removePrivateLibraryImage(
  fileUrl: string | null | undefined,
  remove: (paths: string[]) => PromiseLike<StorageRemovalResult>,
): Promise<boolean> {
  if (!isPrivateLibraryImagePath(fileUrl)) return false;
  const result = await remove([fileUrl]);
  if (result.error) {
    const error = new Error("library_image_storage_remove_failed");
    error.name = "LibraryImageStorageError";
    throw error;
  }
  return true;
}
