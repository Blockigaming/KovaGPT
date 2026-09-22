import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";

const hash = (value) => createHash("sha256").update(value).digest();
const encoded = (value) => Buffer.from(value).toString("base64url");
const cbor = (value) => Buffer.from(isoCBOR.encode(value));

// A synthetic authenticator that uses a real P-256 private key and WebAuthn
// wire-format bytes. Nothing is registered with a real device or deployment.
export function passkeyFixture({
  accountId = "10000000-0000-4000-8000-000000000001",
  backupEligible = false,
} = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const idBytes = randomBytes(32);
  const credentialId = encoded(idBytes);
  const publicKeyBytes = cbor(
    new Map([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x, "base64url")],
      [-3, Buffer.from(jwk.y, "base64url")],
    ]),
  );
  const userHandle = encoded(Buffer.from(accountId, "utf8"));
  const key = {
    credentialId,
    publicKeyHex: publicKeyBytes.toString("hex"),
    counter: 0,
    userHandle,
    backupEligible,
  };
  const credential = {
    credentialId,
    publicKeyHex: key.publicKeyHex,
    counter: 0,
    backupEligible,
    backedUp: backupEligible,
    transports: ["internal"],
  };
  function data(challenge, options, registration) {
    const origin = options.origin ?? "https://kova.test";
    const rpID = options.rpID ?? "kova.test";
    const client = Buffer.from(
      JSON.stringify({
        type: registration ? "webauthn.create" : "webauthn.get",
        origin,
        challenge,
        crossOrigin: false,
        ...options.client,
      }),
    );
    const flags =
      options.flags ?? 0x01 | 0x04 | (registration ? 0x40 : 0) | (backupEligible ? 0x18 : 0);
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(options.counter ?? 0);
    const auth = Buffer.concat([hash(rpID), Buffer.from([flags]), counter]);
    return { client, auth };
  }
  return {
    key,
    credential,
    registration(challenge, options = {}) {
      const { client, auth } = data(challenge, options, true);
      const length = Buffer.alloc(2);
      length.writeUInt16BE(idBytes.length);
      const authData = Buffer.concat([auth, Buffer.alloc(16), length, idBytes, publicKeyBytes]);
      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        response: {
          clientDataJSON: encoded(client),
          attestationObject: encoded(
            cbor(
              new Map([
                ["fmt", "none"],
                ["attStmt", new Map()],
                ["authData", authData],
              ]),
            ),
          ),
          transports: ["internal"],
        },
        clientExtensionResults: { credProps: { rk: true } },
      };
    },
    authentication(challenge, options = {}) {
      const { client, auth } = data(challenge, options, false);
      const signature = sign("sha256", Buffer.concat([auth, hash(client)]), privateKey);
      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        response: {
          clientDataJSON: encoded(client),
          authenticatorData: encoded(auth),
          signature: encoded(signature),
          userHandle,
        },
        clientExtensionResults: {},
      };
    },
  };
}
