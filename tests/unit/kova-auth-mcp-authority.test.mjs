import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  authDatabase,
  passwordAccount,
  digest,
  now,
  owner,
} from "../helpers/kova-auth-database.mjs";
import {
  kovaCompatibilityJwtHasMarker,
  signKovaCompatibilityJwt,
  verifyKovaCompatibilityJwt,
} from "../../src/lib/kova-auth-crypto.server.mjs";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const signingEnv = {
  KOVA_AUTH_JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  KOVA_AUTH_JWT_KEY_ID: "mcp-test",
  KOVA_AUTH_JWT_PUBLIC_KEY_SHA256: createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex"),
  KOVA_AUTH_ISSUER: "https://auth.example.invalid/",
};

function principal(row) {
  return {
    accountId: row.account_id,
    sessionId: row.session_id,
    email: row.email,
    emailVerified: row.email_verified,
    assuranceLevel: row.assurance_level,
  };
}

test("Kova compatibility JWT verification is strict and tamper evident", async () => {
  const issuedAt = Date.parse(now);
  const token = signKovaCompatibilityJwt(
    {
      accountId: owner,
      sessionId: "30000000-0000-4000-8000-000000000003",
      email: "owner@example.invalid",
      emailVerified: true,
      assuranceLevel: "aal2",
    },
    signingEnv,
    issuedAt,
  );
  assert.equal(kovaCompatibilityJwtHasMarker(token), true);
  const claims = verifyKovaCompatibilityJwt(token, signingEnv, issuedAt + 1_000);
  assert.equal(claims.accountId, owner);
  assert.equal(claims.assuranceLevel, "aal2");
  assert.equal(claims.emailVerified, true);

  const [header, payload, signature] = token.split(".");
  const changed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  changed.sub = "40000000-0000-4000-8000-000000000004";
  const tampered = `${header}.${Buffer.from(JSON.stringify(changed)).toString("base64url")}.${signature}`;
  assert.equal(kovaCompatibilityJwtHasMarker(tampered), true);
  assert.throws(() => verifyKovaCompatibilityJwt(tampered, signingEnv, issuedAt + 1_000));

  assert.throws(() => verifyKovaCompatibilityJwt(token, signingEnv, issuedAt + 301_000));
  assert.equal(kovaCompatibilityJwtHasMarker("not-a-jwt"), false);
});

test("MCP compatibility-session proof follows live revocation and account state", async () => {
  const db = await authDatabase();
  try {
    const session = await passwordAccount(db, {
      email: "owner@example.invalid",
      token: "owned-mcp-session",
      at: now,
    });
    const token = signKovaCompatibilityJwt(principal(session), signingEnv, Date.parse(now));
    const claims = verifyKovaCompatibilityJwt(token, signingEnv, Date.parse(now) + 1_000);
    const validate = () =>
      db.query(
        "select public.kova_auth_validate_compatibility_session($1,$2,$3,$4,$5,$6) as ok",
        [
          claims.accountId,
          claims.sessionId,
          claims.email,
          claims.assuranceLevel,
          claims.issuedAt,
          now,
        ],
      );

    assert.equal((await validate()).rows[0].ok, true);
    await db.query("select public.kova_auth_revoke_session($1)", [digest("owned-mcp-session")]);
    assert.equal((await validate()).rows[0].ok, false);
  } finally {
    await db.close();
  }
});

test("compatibility-session validation rejects mismatched identity and remains service-role only", async () => {
  const db = await authDatabase();
  try {
    const session = await passwordAccount(db, {
      email: "owner@example.invalid",
      token: "owned-mcp-session-two",
      at: now,
    });
    const issued = Math.floor(Date.parse(now) / 1000);
    const args = [
      session.account_id,
      session.session_id,
      session.email,
      session.assurance_level,
      issued,
      now,
    ];
    assert.equal(
      (
        await db.query(
          "select public.kova_auth_validate_compatibility_session($1,$2,$3,$4,$5,$6) as ok",
          args,
        )
      ).rows[0].ok,
      true,
    );
    assert.equal(
      (
        await db.query(
          "select public.kova_auth_validate_compatibility_session($1,$2,$3,$4,$5,$6) as ok",
          [session.account_id, session.session_id, "other@example.invalid", session.assurance_level, issued, now],
        )
      ).rows[0].ok,
      false,
    );
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query(
        "select public.kova_auth_validate_compatibility_session($1,$2,$3,$4,$5,$6)",
        args,
      ),
      /permission denied/u,
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});

test("MCP source fails closed to Kova authority in pure mode and gates hosted fallback by mode", async () => {
  const source = await readFile(new URL("../../src/lib/mcp/index.ts", import.meta.url), "utf8");
  assert.match(source, /kovaCompatibilityJwtHasMarker\(token\)/u);
  assert.match(source, /verifyKovaCompatibilityJwt\(token\)/u);
  assert.match(source, /validateCompatibilitySession\(/u);
  assert.match(source, /if \(!kovaAuthEnabled\(mode\)\) return null/u);
  assert.match(source, /if \(!supabaseAuthEnabled\(mode\)\) return null/u);
  assert.match(source, /supabase\.auth\.getUser\(token\)/u);
  assert.ok(
    source.indexOf("if (!supabaseAuthEnabled(mode)) return null") <
      source.indexOf("supabase.auth.getUser(token)"),
  );
});
