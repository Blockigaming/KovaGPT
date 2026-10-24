export function validateLibraryTitle(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 200)
    throw new Error("Use a saved-item title between 1 and 200 characters.");
  return value.trim();
}
