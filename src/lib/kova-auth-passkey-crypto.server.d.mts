import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";

export type VerifiedKovaPasskey = {
  credentialId: string;
  publicKeyHex: string;
  counter: number;
  backupEligible: boolean;
  backedUp: boolean;
  transports: string[];
};
export type KovaPasskeyVerificationKey = {
  credentialId: string;
  publicKeyHex: string;
  counter: number;
  userHandle: string;
  backupEligible: boolean;
};
export function kovaPasskeyRp(origin: string): { origin: string; rpID: string };
export function kovaPasskeyRegistrationOptions(input: {
  accountId: string;
  email: string;
  origin: string;
  credentialIds?: string[];
}): Promise<PublicKeyCredentialCreationOptionsJSON>;
export function kovaPasskeyAuthenticationOptions(
  origin: string,
): Promise<PublicKeyCredentialRequestOptionsJSON>;
export function verifyKovaPasskeyRegistration(
  response: unknown,
  expected: {
    challenge: string;
    origin: string;
    rpID: string;
  },
): Promise<VerifiedKovaPasskey>;
export function verifyKovaPasskeyAuthentication(
  response: unknown,
  expected: {
    challenge: string;
    origin: string;
    rpID: string;
    key: KovaPasskeyVerificationKey;
  },
): Promise<{ counter: number; backedUp: boolean }>;