export function validatePreferredName(
  value: string,
): { name: string; error?: never } | { error: string; name?: never };
export function saveDevicePreferredName<T extends { displayName: string }>(options: {
  settings: T;
  value: string;
  ownerId: string | null;
  currentOwnerId: string | null | undefined;
  save: (ownerId: string, settings: T) => void;
}): { settings: T; error?: never } | { error: string; settings?: never };
