import { digest, now, expiry, owner } from "./kova-auth-database.mjs";
import { passkeyFixture } from "./kova-passkey-fixture.mjs";

export async function beginPasskey(
  db,
  {
    purpose = "registration",
    challenge = "register",
    binding = "binding",
    session = "session",
    credential,
    name = "Device",
    at = now,
    origin = "https://kova.test",
    rp = "kova.test",
  } = {},
) {
  return db.query(
    `select * from public.kova_auth_begin_passkey_challenge($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      purpose,
      digest(challenge),
      digest(binding),
      rp,
      origin,
      purpose === "registration" ? digest(session) : null,
      purpose === "registration" ? (credential?.id ?? null) : null,
      purpose === "registration" ? (credential?.revision ?? null) : null,
      purpose === "registration" ? name : null,
      at,
    ],
  );
}
export async function claimPasskey(
  db,
  {
    purpose = "registration",
    challenge = "register",
    binding = "binding",
    claim = "receipt",
    session = "session",
    at = now,
  } = {},
) {
  return db.query(`select * from public.kova_auth_claim_passkey_challenge($1,$2,$3,$4,$5,$6)`, [
    purpose,
    digest(challenge),
    digest(binding),
    digest(claim),
    purpose === "registration" ? digest(session) : null,
    at,
  ]);
}
export async function finishRegistration(
  db,
  {
    fixture = passkeyFixture(),
    session = "session",
    challenge = "register",
    claim = "receipt",
    next = "registered",
    at = now,
    expiresAt = expiry,
    ...overrides
  } = {},
) {
  const data = { ...fixture.credential, ...overrides };
  return db.query(
    `select * from public.kova_auth_finish_passkey_registration($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      digest(session),
      digest(challenge),
      digest(claim),
      data.credentialId,
      data.publicKeyHex,
      data.counter,
      data.backupEligible,
      data.backedUp,
      data.transports,
      digest(next),
      expiresAt,
      at,
    ],
  );
}
export async function registerPasskey(db, credential, options = {}) {
  const fixture = options.fixture ?? passkeyFixture({ accountId: options.accountId ?? owner });
  await beginPasskey(db, { credential, ...options });
  await claimPasskey(db, options);
  const principal = (await finishRegistration(db, { fixture, ...options })).rows[0];
  const key = (
    await db.query(`select * from public.kova_auth_lookup_passkey($1,$2)`, [
      fixture.key.credentialId,
      options.at ?? now,
    ])
  ).rows[0];
  return { fixture, principal, key };
}
export async function loginChallenge(db, suffix = "login", at = now) {
  const options = { purpose: "authentication", challenge: suffix, claim: `${suffix}-receipt`, at };
  await beginPasskey(db, options);
  await claimPasskey(db, options);
  return options;
}
export async function finishLogin(
  db,
  key,
  {
    challenge = "login",
    claim = "login-receipt",
    next = "logged-in",
    at = now,
    expiresAt = expiry,
    counter = 1,
    ...overrides
  } = {},
) {
  const k = { ...key, ...overrides };
  return db.query(
    `select * from public.kova_auth_finish_passkey_login($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      digest(challenge),
      digest(claim),
      k.passkey_id,
      k.revision,
      k.sign_count,
      counter,
      k.session_epoch,
      k.user_handle,
      k.backup_eligible,
      digest(next),
      expiresAt,
      at,
    ],
  );
}