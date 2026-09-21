import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { clearKovaAuthCache, kovaAuthJson } from "@/lib/kova-auth-browser";

const ROOT = "/api/auth/passkeys";
async function payload(response: Response): Promise<Record<string, unknown>> {
  const data: unknown = await response.json();
  if (!response.ok || !data || typeof data !== "object" || Array.isArray(data))
    throw new Error("kova_passkey_request_failed");
  return data as Record<string, unknown>;
}
function options<T extends { challenge: string }>(
  data: Record<string, unknown>,
): { optionsJSON: T; challengeToken: string } {
  const value = data.options as Partial<T> | undefined;
  if (
    typeof data.challengeToken !== "string" ||
    !/^[A-Za-z0-9_-]{43,256}$/u.test(data.challengeToken) ||
    !value ||
    value.challenge !== data.challengeToken
  )
    throw new Error("kova_passkey_options_invalid");
  return { optionsJSON: value as T, challengeToken: data.challengeToken };
}
async function finish(path: string, body: Record<string, unknown>): Promise<void> {
  // An uncertain response can follow an already committed cookie rotation.
  try {
    const data = await payload(await kovaAuthJson(path, body));
    const session = data.session as { accountId?: unknown; assuranceLevel?: unknown } | undefined;
    if (
      typeof session?.accountId !== "string" ||
      (session.assuranceLevel !== "aal1" && session.assuranceLevel !== "aal2")
    ) {
      throw new Error("kova_passkey_session_invalid");
    }
  } finally {
    clearKovaAuthCache();
  }
}
export async function registerKovaPasskey(input: {
  friendlyName: string;
  currentPassword?: string;
}): Promise<void> {
  const data = options<PublicKeyCredentialCreationOptionsJSON>(
    await payload(await kovaAuthJson(`${ROOT}/register/options`, input)),
  );
  const response = await startRegistration({ optionsJSON: data.optionsJSON });
  await finish(`${ROOT}/register/verify`, { challengeToken: data.challengeToken, response });
}
export async function signInWithKovaPasskey(): Promise<void> {
  const data = options<PublicKeyCredentialRequestOptionsJSON>(
    await payload(await kovaAuthJson(`${ROOT}/login/options`, {})),
  );
  const response = await startAuthentication({ optionsJSON: data.optionsJSON });
  await finish(`${ROOT}/login/verify`, { challengeToken: data.challengeToken, response });
}
export async function renameKovaPasskey(passkeyId: string, friendlyName: string): Promise<void> {
  const data = await payload(await kovaAuthJson(`${ROOT}/rename`, { passkeyId, friendlyName }));
  if (data.renamed !== true) throw new Error("kova_passkey_rename_failed");
}
export async function removeKovaPasskey(passkeyId: string): Promise<void> {
  await finish(`${ROOT}/remove`, { passkeyId, confirm: true });
}