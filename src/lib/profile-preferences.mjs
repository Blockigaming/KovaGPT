export function validatePreferredName(value) {
  const name = value.trim();
  if (name.length > 80) return { error: "Use 80 characters or fewer." };
  if (/[\u0000-\u001f\u007f]/u.test(name))
    return { error: "Use a name without control characters." };
  return { name };
}

// Persist before publishing a changed name to the current UI. This does not
// update an authentication profile, verified identity, or another principal.
export function saveDevicePreferredName({ settings, value, ownerId, currentOwnerId, save }) {
  if (!ownerId || currentOwnerId !== ownerId) {
    return { error: "Your account changed. Reopen Profile before saving." };
  }
  const validation = validatePreferredName(value);
  if (validation.error) return validation;
  const next = { ...settings, displayName: validation.name };
  try {
    save(ownerId, next);
    return { settings: next };
  } catch {
    return {
      error:
        "Your name could not be saved on this device. Your previous name is unchanged. Try again.",
    };
  }
}
