import assert from "node:assert/strict";
import * as nodeCrypto from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as contract from "../../src/lib/kova-auth-contract.mjs";
import * as crypto from "../../src/lib/kova-auth-crypto.server.mjs";
import * as security from "../../src/lib/auth-security.mjs";
import * as reliability from "../../src/lib/endpoint-reliability.mjs";

const compile = (path) =>
  ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const storeSource = compile("src/lib/kova-auth-store.server.ts");
const httpSource = compile("src/lib/kova-auth-http.server.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));

// Real handler, store, password crypto, cookie handling, CSRF and body parsing.
// Only external database/rate-limit transport and local TOTP test configuration
// are injected. No deployed account or secret is accessed by this harness.
export function authHttp(options = {}) {
  const calls = [],
    limits = [],
    logs = [];
  const modules = {
    "node:crypto": nodeCrypto,
    "@/lib/kova-auth-crypto.server.mjs": { ...crypto, ...options.crypto },
    "@/lib/kova-auth-contract.mjs": {
      ...contract,
      resolveKovaAuthMode: () => options.mode ?? "kova",
    },
    "@/lib/auth-security.mjs": security,
    "@/lib/chat-ingress.server.mjs": { resolveAnonymousClientKey: () => "fixture-client" },
    "@/lib/endpoint-reliability.mjs": reliability,
    "@/lib/distributed-rate-limit.server": {
      async consumeApplicationRateLimit(input) {
        limits.push(plain(input));
        if (options.limit) return options.limit(input);
        return { allowed: true };
      },
    },
    "@/integrations/supabase/client.server": {
      supabaseAdmin: {
        async rpc(name, args) {
          calls.push([name, plain(args)]);
          assert.equal(typeof options.rpc, "function");
          return options.rpc(name, args);
        },
      },
    },
  };
  function load(source) {
    const exports = {};
    vm.runInNewContext(source, {
      exports,
      Request,
      Response,
      Headers,
      URL,
      Buffer,
      Error,
      TypeError,
      Date,
      process: { env: {} },
      console: { error: (...args) => logs.push(args) },
      require: (name) => {
        assert.ok(Object.hasOwn(modules, name), `Unexpected module: ${name}`);
        return modules[name];
      },
    });
    return exports;
  }
  const store = load(storeSource);
  modules["@/lib/kova-auth-store.server"] = store;
  return { ...load(httpSource), store, calls, limits, logs };
}

export function authRequest(
  body,
  { path = "/api/auth/password", token = "s".repeat(43), method = "POST", headers = {}, raw } = {},
) {
  return new Request(`https://kova.test${path}`, {
    method,
    headers: {
      Origin: "https://kova.test",
      "Content-Type": "application/json",
      Cookie: `__Host-kova_session=${token}`,
      ...headers,
    },
    ...(method === "POST" ? { body: raw ?? JSON.stringify(body) } : {}),
  });
}

export function postgresTransport(db, names) {
  const allowed = new Set(names);
  return async (name, args) => {
    assert.ok(allowed.has(name), `Unexpected RPC: ${name}`);
    const keys = Object.keys(args);
    assert.ok(keys.every((key) => /^p_[a-z_]+$/u.test(key)));
    try {
      const result = await db.query(
        `select * from public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(",")})`,
        Object.values(args),
      );
      return { data: result.rows };
    } catch (error) {
      return { error: { code: error.code, message: error.message } };
    }
  };
}