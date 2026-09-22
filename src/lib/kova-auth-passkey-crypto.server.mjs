import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { decodeAttestationObject } from "@simplewebauthn/server/helpers";

const ALGORITHMS = [-7, -257, -8];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const TRANSPORTS = new Set(["usb", "nfc", "ble", "internal", "hybrid", "cable", "smart-card"]);

function decode(value, maxBytes) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]+$/u.test(value) ||
    value.length > maxBytes * 2
  ) {
    throw new TypeError("Invalid passkey response");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length > maxBytes || bytes.toString("base64url") !== value) {
    throw new TypeError("Invalid passkey response");
  }
  return bytes;
}

function validateResponse(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.type !== "public-key" ||
    value.id !== value.rawId ||
    !value.response ||
    typeof value.response !== "object" ||
    Array.isArray(value.response)
  )
    throw new TypeError("Invalid passkey response");
  decode(value.id, 1536);
  const client = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(decode(value.response.clientDataJSON, 4096)),
  );
  // This application does not support embedded/cross-origin authentication.
  // The RP origin and expected challenge are checked by the library as well.
  if (
    !client ||
    typeof client !== "object" ||
    Array.isArray(client) ||
    (client.crossOrigin !== undefined && client.crossOrigin !== false) ||
    client.topOrigin !== undefined
  )
    throw new TypeError("Invalid passkey response");
  return value;
}

export function kovaPasskeyRp(origin) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin || url.hostname.startsWith("[")) {
    throw new TypeError("Invalid passkey relying party");
  }
  return { origin, rpID: url.hostname };
}

export async function kovaPasskeyRegistrationOptions({
  accountId,
  email,
  origin,
  credentialIds = [],
}) {
  if (!UUID.test(accountId) || credentialIds.length > 10)
    throw new TypeError("Invalid passkey account");
  const { rpID } = kovaPasskeyRp(origin);
  return generateRegistrationOptions({
    rpName: "KovaGPT",
    rpID,
    userID: Buffer.from(accountId, "utf8"),
    userName: email,
    attestationType: "none",
    timeout: 60_000,
    supportedAlgorithmIDs: ALGORITHMS,
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    excludeCredentials: credentialIds.map((id) => ({ id })),
  });
}

export async function kovaPasskeyAuthenticationOptions(origin) {
  return generateAuthenticationOptions({
    rpID: kovaPasskeyRp(origin).rpID,
    userVerification: "required",
    timeout: 60_000,
    allowCredentials: [],
  });
}

export async function verifyKovaPasskeyRegistration(value, { challenge, origin, rpID }) {
  const response = validateResponse(value);
  // Attestation is deliberately none: no vendor certificates, remote trust
  // metadata, or authenticator-network requests enter the verification path.
  const attestation = decodeAttestationObject(decode(response.response.attestationObject, 6144));
  if (attestation.get("fmt") !== "none") throw new TypeError("Unsupported passkey attestation");
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    expectedType: "webauthn.create",
    requireUserPresence: true,
    requireUserVerification: true,
    supportedAlgorithmIDs: ALGORITHMS,
  });
  if (!result.verified || !result.registrationInfo.userVerified)
    throw new TypeError("Invalid passkey response");
  const info = result.registrationInfo;
  if (info.credential.id !== response.id) throw new TypeError("Invalid passkey response");
  return {
    credentialId: info.credential.id,
    publicKeyHex: Buffer.from(info.credential.publicKey).toString("hex"),
    counter: info.credential.counter,
    backupEligible: info.credentialDeviceType === "multiDevice",
    backedUp: info.credentialBackedUp,
    transports: [
      ...new Set((info.credential.transports ?? []).filter((value) => TRANSPORTS.has(value))),
    ].slice(0, 10),
  };
}

export async function verifyKovaPasskeyAuthentication(value, { challenge, origin, rpID, key }) {
  const response = validateResponse(value);
  decode(response.response.authenticatorData, 4096);
  decode(response.response.signature, 1024);
  if (response.id !== key.credentialId || response.response.userHandle !== key.userHandle) {
    throw new TypeError("Invalid passkey response");
  }
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    expectedType: "webauthn.get",
    requireUserVerification: true,
    credential: {
      id: key.credentialId,
      publicKey: new Uint8Array(Buffer.from(key.publicKeyHex, "hex")),
      counter: key.counter,
    },
  });
  const info = result.authenticationInfo;
  if (
    !result.verified ||
    !info.userVerified ||
    info.credentialID !== key.credentialId ||
    (info.credentialDeviceType === "multiDevice") !== key.backupEligible
  ) {
    throw new TypeError("Invalid passkey response");
  }
  return { counter: info.newCounter, backedUp: info.credentialBackedUp };
}
