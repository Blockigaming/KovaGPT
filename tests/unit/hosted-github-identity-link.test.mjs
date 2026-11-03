import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync("src/lib/hosted-github-identity-link.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const redirect =
  "https://github.com/login/oauth/authorize?client_id=fixture&state=fixture-state&scope=user%3Aemail&redirect_uri=https%3A%2F%2Ffixture.supabase.co%2Fauth%2Fv1%2Fcallback";
function fixture({
  user = {
    id: "owner",
    email: "owner@example.invalid",
    email_confirmed_at: "2026-01-01",
    identities: [],
  },
  start = async () => ({ data: { url: redirect }, error: null }),
  rejectAuthority = false,
} = {}) {
  const events = [];
  let current = true;
  let activeUser = user;
  const api = {};
  const modules = {
    "@/integrations/supabase/client": {
      resolveLegacyAuthContext: async () => {
        if (rejectAuthority) throw new Error("hosted_auth_unavailable");
        return {
          assertCurrent() {
            if (!current) throw new Error("changed");
          },
          auth: {
            getUser: async () => ({ data: { user: activeUser }, error: null }),
            linkIdentity: async (input) => {
              events.push(input);
              return start();
            },
          },
        };
      },
    },
    "@/integrations/supabase/config": {
      SUPABASE_BROWSER_CONFIG: { url: "https://fixture.supabase.co" },
    },
    "@/lib/oauth-session": {
      getOAuthRedirectUri: () => "https://kovagpt.com/~oauth/callback",
      rememberPostAuthRedirect() {},
    },
  };
  vm.runInNewContext(source, {
    exports: api,
    URL,
    require(name) {
      assert.ok(modules[name], name);
      return modules[name];
    },
  });
  return {
    api,
    events,
    current: () => current,
    cancel: () => {
      current = false;
    },
    switchOwner: () => {
      activeUser = { ...user, id: "other" };
    },
  };
}

test("GitHub identity linking uses the verified existing owner and minimal OAuth scope", async () => {
  const f = fixture();
  assert.equal((await f.api.hostedGitHubLinkStatus("owner", f.current)).linked, false);
  assert.equal(await f.api.beginHostedGitHubIdentityLink("owner", f.current), redirect);
  assert.deepEqual(JSON.parse(JSON.stringify(f.events)), [
    {
      provider: "github",
      options: {
        redirectTo: "https://kovagpt.com/~oauth/callback",
        scopes: "user:email",
        skipBrowserRedirect: true,
      },
    },
  ]);
});

for (const user of [
  null,
  { id: "other", email_confirmed_at: "2026-01-01" },
  { id: "owner", email_confirmed_at: null },
]) {
  test(`identity linking requires the current verified owner (${JSON.stringify(user)})`, async () => {
    const f = fixture({ user });
    await assert.rejects(f.api.beginHostedGitHubIdentityLink("owner", f.current));
    assert.equal(f.events.length, 0);
  });
}

test("owned authority cannot start a hosted identity link", async () => {
  const f = fixture({ rejectAuthority: true });
  await assert.rejects(f.api.beginHostedGitHubIdentityLink("owner", f.current));
  assert.equal(f.events.length, 0);
});

for (const change of ["cancel", "switchOwner"])
  test(`a ${change} while linking prevents redirect`, async () => {
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const f = fixture({ start: () => pending });
    const attempt = f.api.beginHostedGitHubIdentityLink("owner", f.current);
    while (!f.events.length) await new Promise((resolve) => setTimeout(resolve, 0));
    f[change]();
    release({ data: { url: redirect }, error: null });
    await assert.rejects(attempt);
  });

test("an existing GitHub identity is reported without starting a new linking request", async () => {
  const f = fixture({
    user: { id: "owner", email_confirmed_at: "2026-01-01", identities: [{ provider: "github" }] },
  });
  assert.equal(await f.api.beginHostedGitHubIdentityLink("owner", f.current), null);
  assert.equal(f.events.length, 0);
});

test("provider failures cannot manufacture a successful link", async () => {
  const f = fixture({
    start: async () => ({ data: null, error: new Error("manual_linking_disabled") }),
  });
  await assert.rejects(f.api.beginHostedGitHubIdentityLink("owner", f.current));
});

test("link redirects reject wrong providers, callbacks, credentials, duplicate parameters and repo scopes", () => {
  const { api } = fixture();
  for (const value of [
    redirect.replace("https://github.com", "https://evil.example"),
    redirect.replace("fixture.supabase.co", "other.supabase.co"),
    redirect.replace("user%3Aemail", "repo"),
    `${redirect}&state=another`,
    redirect.replace("https://github.com", "http://github.com"),
    redirect.replace("https://github.com", "https://user@github.com"),
    `${redirect}#secret`,
    "javascript:alert(1)",
    null,
  ]) {
    assert.throws(() =>
      api.validateGitHubIdentityLinkRedirect(value, "https://fixture.supabase.co"),
    );
  }
});
