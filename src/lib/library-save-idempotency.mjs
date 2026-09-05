export async function librarySaveFingerprint(values, bytes) {
  const digest = async (input) =>
    Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", input)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  const bodyHash = bytes ? await digest(bytes) : null;
  return digest(new TextEncoder().encode(JSON.stringify([values, bodyHash])));
}

export function assertLibrarySaveReplay(row, fingerprint) {
  if (row?.metadata?.library_save_fingerprint !== fingerprint) {
    throw new Error("This save identifier was already used for a different Library item.");
  }
  return { id: row.id };
}
