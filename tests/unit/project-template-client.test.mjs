import assert from "node:assert/strict";
import test from "node:test";
import {
  createProjectTemplateClient,
  prepareProjectTemplateOperation,
  projectTemplateFailureMessage,
  ProjectTemplateRequestError,
} from "../../src/lib/project-template-client.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const templateId = "22222222-2222-4222-8222-222222222222";
const projectId = "33333333-3333-4333-8333-333333333333";
const mutationId = "44444444-4444-4444-8444-444444444444";
const snapshot = {
  projectName: "Planning",
  projectDescription: null,
  systemPrompt: "Plan carefully.",
  color: "blue",
};
const session = () =>
  Promise.resolve({ data: { session: { user: { id: userId }, access_token: "fixture-token" } } });
const summary = (overrides = {}) => ({
  id: templateId,
  ownerId: userId,
  name: "Planning template",
  description: null,
  currentVersion: 2,
  revision: 3,
  archivedAt: null,
  canCopy: true,
  versions: [
    { version: 2, createdAt: "2026-09-04" },
    { version: 1, createdAt: "2026-09-03" },
  ],
  grants: [],
  ...overrides,
});

function makeClient(fetcher, options = {}) {
  return createProjectTemplateClient({ userId, getSession: session, fetcher, ...options });
}

test("an uncertain write retries exact mutation bytes and never adopts later form changes", async () => {
  const draft = { ...snapshot };
  const operation = prepareProjectTemplateOperation(
    { action: "create", name: "Planning", description: null, snapshot: draft },
    mutationId,
  );
  draft.projectName = "Edited after dispatch";
  const sent = [];
  const client = makeClient(async (url, init) => {
    sent.push({ url, body: init.body, headers: init.headers });
    if (sent.length === 1) throw new TypeError("private provider diagnostic");
    return Response.json({ result: { templateId, version: 1, revision: 1 } });
  });
  await assert.rejects(
    client.mutate(operation),
    (error) => error instanceof ProjectTemplateRequestError && error.uncertain,
  );
  assert.equal((await client.mutate(operation)).templateId, templateId);
  assert.equal(sent[0].body, sent[1].body);
  assert.equal(JSON.parse(sent[0].body).mutationId, mutationId);
  assert.equal(JSON.parse(sent[0].body).snapshot.projectName, "Planning");
  assert.equal(sent[0].headers.Authorization, "Bearer fixture-token");
  assert.ok(
    !projectTemplateFailureMessage(new TypeError("private provider diagnostic")).includes(
      "private provider",
    ),
  );
});

test("credentials from a different account never dispatch an old account's draft", async () => {
  let requests = 0;
  const client = makeClient(
    async () => {
      requests += 1;
      return Response.json({});
    },
    {
      getSession: async () => ({
        data: { session: { user: { id: projectId }, access_token: "other-account-token" } },
      }),
    },
  );
  await assert.rejects(client.list(), (error) => error.status === 401 && !error.uncertain);
  assert.equal(requests, 0);
});

test("the deadline covers stalled session lookup and late credentials cannot start a request", async () => {
  let resume;
  let requests = 0;
  const client = makeClient(
    async () => {
      requests += 1;
      return Response.json({});
    },
    {
      timeoutMs: 10,
      getSession: () =>
        new Promise((resolve) => {
          resume = resolve;
        }),
    },
  );
  await assert.rejects(client.list(), (error) => error.status === 503 && !error.uncertain);
  resume(await session());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests, 0);
});

test("a stalled mutation response body is uncertain and preserves the retry operation", async () => {
  const operation = prepareProjectTemplateOperation(
    { action: "copy", templateId, version: 1 },
    mutationId,
  );
  const client = makeClient(async () => ({ ok: true, json: () => new Promise(() => {}) }), {
    timeoutMs: 10,
  });
  await assert.rejects(client.mutate(operation), (error) => error.uncertain === true);
  assert.equal(JSON.parse(operation.body).version, 1);
});

test("copying and inspecting always use the explicitly selected immutable version", async () => {
  const calls = [];
  const client = makeClient(async (url, init) => {
    calls.push({ url, init });
    return init.method === "GET"
      ? Response.json({
          templateId,
          ownerId: userId,
          name: "Planning",
          description: null,
          version: 1,
          currentVersion: 2,
          revision: 3,
          canCopy: true,
          snapshot,
        })
      : Response.json({ result: { templateId, projectId, version: 1 } });
  });
  const version = await client.version(templateId, 1);
  assert.equal(version.version, 1);
  const operation = prepareProjectTemplateOperation(
    { action: "copy", templateId, version: version.version },
    mutationId,
  );
  assert.equal((await client.mutate(operation)).projectId, projectId);
  assert.match(calls[0].url, /&version=1$/u);
  assert.equal(JSON.parse(calls[1].init.body).version, 1);
});

test("a version response for another selection is rejected instead of being displayed", async () => {
  const client = makeClient(async () =>
    Response.json({
      templateId,
      ownerId: userId,
      name: "Planning",
      description: null,
      version: 2,
      currentVersion: 2,
      revision: 3,
      canCopy: true,
      snapshot,
    }),
  );
  await assert.rejects(client.version(templateId, 1), (error) => error.status === 503);
});

test("revision conflicts are definitive and never automatically rebase or resubmit edits", async () => {
  let requests = 0;
  const client = makeClient(async () => {
    requests += 1;
    return Response.json({ error: "project_template_conflict" }, { status: 409 });
  });
  const operation = prepareProjectTemplateOperation(
    { action: "publishVersion", templateId, expectedRevision: 3, snapshot },
    mutationId,
  );
  await assert.rejects(
    client.mutate(operation),
    (error) => error.status === 409 && !error.uncertain,
  );
  assert.equal(requests, 1);
  assert.equal(JSON.parse(operation.body).expectedRevision, 3);
});

test("received template lists expose view-only access without granting owner management", async () => {
  const client = makeClient(async () =>
    Response.json({
      templates: [
        summary({
          ownerId: projectId,
          canCopy: false,
          grants: [{ granteeUserId: mutationId, canCopy: true, revokedAt: null }],
        }),
      ],
    }),
  );
  const [received] = await client.list();
  assert.equal(received.canCopy, false);
  assert.notEqual(received.ownerId, userId);
  assert.deepEqual(received.grants, []);
});

test("revoked access is reported without retrying the mutation or exposing backend details", async () => {
  const client = makeClient(async () =>
    Response.json({ error: "private_schema_detail" }, { status: 403 }),
  );
  await assert.rejects(client.version(templateId, 1), (error) => {
    assert.match(projectTemplateFailureMessage(error), /access changed/u);
    assert.ok(!projectTemplateFailureMessage(error).includes("private_schema_detail"));
    return !error.uncertain;
  });
});

test("a malformed successful mutation response stays retryable with its original UUID", async () => {
  const client = makeClient(async () =>
    Response.json({ result: { templateId: projectId, projectId, version: 1 } }),
  );
  const operation = prepareProjectTemplateOperation(
    { action: "copy", templateId, version: 1 },
    mutationId,
  );
  await assert.rejects(client.mutate(operation), (error) => error.uncertain === true);
  assert.equal(JSON.parse(operation.body).mutationId, mutationId);
});
