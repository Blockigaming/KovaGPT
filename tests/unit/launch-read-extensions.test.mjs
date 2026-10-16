import test from "node:test";
import assert from "node:assert/strict";
import { executeProviderRead } from "../../src/integrations/launch-providers.server.mjs";
import {
  LAUNCH_CONNECTORS,
  CERTIFIED_LAUNCH_CONNECTORS,
} from "../../src/integrations/launch-contracts.mjs";
import { createLaunchToolContext } from "../../src/integrations/launch-tools.server.mjs";
const metadata = {
  id: "file",
  name: "Notes",
  size: 5,
  file: { mimeType: "text/plain" },
  eTag: "rev1",
  "@microsoft.graph.downloadUrl": "https://tenant.sharepoint.com/download?private=secret",
};
const token = (id) => ({ accessToken: "OAUTH-SECRET", scopes: LAUNCH_CONNECTORS[id].permissions });
test("OneDrive and SharePoint text reads separate credentials and validate source revision", async () => {
  for (const id of ["onedrive", "sharepoint"]) {
    const calls = [];
    const result = await executeProviderRead(
      id,
      "read_file_text",
      { id: "file", ...(id === "sharepoint" ? { siteId: "site" } : {}) },
      token(id),
      null,
      {
        fetchImpl: async (url, init) => {
          calls.push(url);
          assert.equal(init.redirect, "error");
          if (calls.length === 1) {
            assert.equal(init.headers.Authorization, "Bearer OAUTH-SECRET");
            return Response.json(metadata);
          }
          if (calls.length === 2) {
            assert.equal(init.headers.Authorization, undefined);
            return new Response("hello");
          }
          assert.equal(init.headers.Authorization, "Bearer OAUTH-SECRET");
          return Response.json({ id: "file", eTag: "rev1" });
        },
      },
    );
    assert.equal(calls.length, 3);
    assert.equal(result.items[0].text, "hello");
    assert.equal(result.items[0].complete, true);
    assert.equal(result.contentIsUntrusted, true);
    assert.ok(!JSON.stringify(result).includes("private=secret"));
  }
});
test("file text fails closed for unsupported content, redirect targets, partial bodies and changed revision", async () => {
  for (const variant of ["office", "large", "host", "partial", "changed", "invalidUtf8"]) {
    let calls = 0;
    const data = { ...metadata, file: { ...metadata.file } };
    if (variant === "office") data.file.mimeType = "application/pdf";
    if (variant === "large") data.size = 65537;
    if (variant === "host")
      data["@microsoft.graph.downloadUrl"] =
        "https://tenant.sharepoint.com.attacker.example/private";
    await assert.rejects(
      executeProviderRead("onedrive", "read_file_text", { id: "file" }, token("onedrive"), null, {
        fetchImpl: async () => {
          calls++;
          if (calls === 1) return Response.json(data);
          if (calls === 2)
            return variant === "partial"
              ? new Response("hel", { status: 206 })
              : variant === "invalidUtf8"
                ? new Response(new Uint8Array([255]))
                : new Response("hello");
          return Response.json({ id: "file", eTag: "rev2" });
        },
      }),
      /file_/,
    );
    if (["office", "large", "host"].includes(variant)) assert.equal(calls, 1);
  }
});
test("Teams channel operations require their own existing read scopes; consent and certification remain unchanged", async () => {
  assert.deepEqual(CERTIFIED_LAUNCH_CONNECTORS, []);
  assert.ok(!LAUNCH_CONNECTORS["ms-teams"].scopes.includes("ChannelMessage.Read.All"));
  for (const [operation, args, scope, path] of [
    ["list_teams", {}, "Team.ReadBasic.All", "/me/joinedTeams"],
    ["list_channels", { teamId: "team" }, "Channel.ReadBasic.All", "/teams/team/channels"],
    [
      "list_channel_messages",
      { teamId: "team", channelId: "channel" },
      "ChannelMessage.Read.All",
      "/teams/team/channels/channel/messages",
    ],
    [
      "list_channel_replies",
      { teamId: "team", channelId: "channel", messageId: "message" },
      "ChannelMessage.Read.All",
      "/teams/team/channels/channel/messages/message/replies",
    ],
  ]) {
    let calls = 0;
    const transport = {
      fetchImpl: async (url) => {
        calls++;
        assert.equal(new URL(url).pathname, "/v1.0" + path);
        if (operation === "list_teams") assert.equal(new URL(url).search, "");
        return Response.json({
          value: [{ id: "item", displayName: "Name", body: { content: "body" } }],
        });
      },
    };
    await assert.rejects(
      executeProviderRead("ms-teams", operation, args, token("ms-teams"), null, transport),
      /permission_incomplete/,
    );
    assert.equal(calls, 0);
    const result = await executeProviderRead(
      "ms-teams",
      operation,
      args,
      { ...token("ms-teams"), scopes: ["Chat.Read", scope] },
      null,
      transport,
    );
    assert.equal(result.items[0].id, "item");
  }
  const account = {
    id: "account",
    owner_id: "owner",
    provider_id: "ms-teams",
    status: "connected",
    granted_scopes: ["Chat.Read"],
  };
  const context = createLaunchToolContext({
    ownerId: "owner",
    sessionId: "session",
    accounts: [account],
    runtime: {},
    certified: ["ms-teams"],
  });
  assert.deepEqual(
    context.tools.map((t) => t.function.name),
    ["launch_ms_teams_list_chats", "launch_ms_teams_list_messages"],
  );
});
