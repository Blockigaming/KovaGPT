const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function key() {
  const source = process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY;
  if (!source) throw new Error("connector_encryption_not_configured");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(source) || source.length % 4 === 1) {
    throw new Error("connector_encryption_key_must_be_32_bytes");
  }
  const bytes = Uint8Array.from(Buffer.from(source, "base64"));
  const canonical = Buffer.from(bytes).toString("base64");
  const paddedSource = source.padEnd(Math.ceil(source.length / 4) * 4, "=");
  if (bytes.length !== 32 || canonical !== paddedSource) {
    throw new Error("connector_encryption_key_must_be_32_bytes");
  }
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function requireCredentialVaultConfiguration() {
  await key();
}

export async function encryptCredential(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(),
    encoder.encode(value),
  );
  return `v1.${Buffer.from(iv).toString("base64url")}.${Buffer.from(encrypted).toString("base64url")}`;
}

export async function decryptCredential(value: string) {
  const [version, iv, body] = value.split(".");
  if (version !== "v1" || !iv || !body) throw new Error("invalid_credential_ciphertext");
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(iv, "base64url") },
    await key(),
    Buffer.from(body, "base64url"),
  );
  return decoder.decode(clear);
}

export async function sha256(value: string) {
  return Buffer.from(await crypto.subtle.digest("SHA-256", encoder.encode(value))).toString("hex");
}
