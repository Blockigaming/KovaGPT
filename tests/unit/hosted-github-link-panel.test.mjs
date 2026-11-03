import assert from "node:assert/strict";
import test from "node:test";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";

function fixture({
  linked = false,
  start = async () => "https://github.com/login/oauth/authorize",
} = {}) {
  let ownerId = "owner";
  const calls = [],
    redirects = [];
  const f = reactFixture(
    "src/components/HostedGitHubLinkPanel.tsx",
    (exports) => () => exports.HostedGitHubLinkPanel(),
    {
      globals: { window: { location: { assign: (url) => redirects.push(url) } } },
      modules: {
        "@/components/auth/ClerkSafe": {
          useUser: () => ({ user: ownerId ? { id: ownerId } : null, isLoaded: true }),
        },
        "@/lib/hosted-github-identity-link": {
          hostedGitHubLinkStatus: async (id) => ({ email: `${id}@example.invalid`, linked }),
          beginHostedGitHubIdentityLink: async (id, current) => {
            calls.push({ id, current });
            return start();
          },
        },
      },
    },
  );
  return {
    f,
    calls,
    redirects,
    switchOwner: (next) => {
      ownerId = next;
    },
  };
}

test("the link panel requires an explicit click and serializes provider starts", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const { f, calls, redirects } = fixture({ start: () => pending });
  await f.flush();
  assert.equal(calls.length, 0);
  const click = f.find("button", (node) => node.props.children === "Add GitHub sign-in").props
    .onClick;
  click();
  click();
  await f.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, "owner");
  assert.ok(f.text().includes("Connecting"));
  release("https://github.com/login/oauth/authorize");
  await f.flush();
  assert.deepEqual(redirects, ["https://github.com/login/oauth/authorize"]);
});

for (const change of ["account", "unmount"])
  test(`${change} while linking prevents the old panel from navigating`, async () => {
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const { f, calls, redirects, switchOwner } = fixture({ start: () => pending });
    await f.flush();
    await f.click("Add GitHub sign-in");
    if (change === "account") {
      switchOwner("other");
      await f.flush();
    } else f.unmount();
    assert.equal(calls[0].current(), false);
    release("https://github.com/login/oauth/authorize");
    await f.flush();
    assert.equal(redirects.length, 0);
  });

test("linked status is shown only from a fresh account read", async () => {
  const { f, calls } = fixture({ linked: true });
  await f.flush();
  assert.ok(f.text().includes("GitHub is linked to owner@example.invalid"));
  assert.equal(calls.length, 0);
});

test("a rejected link leaves a retryable error and does not claim success", async () => {
  const { f, redirects } = fixture({
    start: async () => {
      throw new Error("disabled");
    },
  });
  await f.flush();
  await f.click("Add GitHub sign-in");
  await f.flush();
  assert.ok(f.text().includes("could not be confirmed"));
  assert.ok(!f.text().includes("GitHub is linked"));
  assert.equal(redirects.length, 0);
});
