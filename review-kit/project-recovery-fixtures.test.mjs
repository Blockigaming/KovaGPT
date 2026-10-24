import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { toJSON } from "seroval";
import {
  FIXTURE_ORIGIN,
  REVIEW_OWNER,
  FixtureRegistry,
  createFixtureSession,
  loadReviewPackage,
} from "./private-http-review.mjs";
import * as sourceState from "./review-state-fixtures.mjs";

// Existing packaged fixtures only: no build, browser, listener, or provider.
assert.ok(process.env.KOVA_REVIEW_PACKAGE, "Set KOVA_REVIEW_PACKAGE to an existing review package");
const pkg = { ...(await loadReviewPackage(process.env.KOVA_REVIEW_PACKAGE)), state: sourceState };
const projectId = "33333333-3333-4333-8333-333333333333";
const viewerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
const defaults = {
  account: "free",
  theme: "dark",
  path: "/",
  size: "phone",
  state: "populated",
  scenario: "project-mutation-recovery",
};
const serverURL = (name) => {
  const entry = [...pkg.base.functionNames].find(([, value]) => value.split("_")[0] === name);
  assert.ok(entry, `Packaged function manifest includes ${name}`);
  return `${FIXTURE_ORIGIN}/_serverFn/${entry[0]}`;
};
const invoke = (session, name, data = {}, method = "GET", headers = {}) => {
  const payload = JSON.stringify(toJSON({ data, context: {} }));
  return session.registry.dispatch({
    url: serverURL(name) + (method === "GET" ? `?payload=${encodeURIComponent(payload)}` : ""),
    method,
    headers,
    body: method === "GET" ? Buffer.alloc(0) : Buffer.from(payload),
  });
};
const rows = async (session, name) => {
  const response = await invoke(session, name, { project_id: projectId });
  assert.equal(response.status ?? 200, 200);
  return response.json.result;
};
const mutate = (session, name, data) => invoke(session, name, data, "POST");
const success = (response) =>
  assert.deepEqual(response.json, { result: { ok: true }, context: {} });

test("Project scenarios require signed-in HTTP review and select only the existing project", async () => {
  for (const scenario of ["project-list-recovery", "project-mutation-recovery"]) {
    const option = sourceState.REVIEW_STATE_OPTIONS.find((option) => option.id === scenario);
    assert.deepEqual(option.accounts, ["free", "plus", "pro"]);
    assert.equal(option.path, `/projects/${projectId}`);
    assert.match(option.label, /fail once/);
    assert.match(option.label, /[Rr]etry/);
    await assert.rejects(
      sourceState.installReviewState({}, scenario, "free"),
      /ordinary private HTTP/,
    );
    await assert.rejects(
      createFixtureSession(pkg, { ...defaults, scenario, account: "guest" }),
      /requires/,
    );
    for (const account of option.accounts) {
      const session = await createFixtureSession(pkg, { ...defaults, scenario, account });
      assert.equal(session.selection.path, `/projects/${projectId}`);
      const project = (await invoke(session, "getProject", { id: projectId })).json.result;
      assert.equal(project.owner_id, REVIEW_OWNER);
      assert.equal(project.role, "owner");
    }
  }
});

test("Nested task and memory list failures recover independently on Retry and reset re-arms them", async () => {
  for (const state of ["populated", "empty", "error", "loading"]) {
    const session = await createFixtureSession(pkg, {
      ...defaults,
      scenario: "project-list-recovery",
      state,
    });
    for (const name of ["listTasks", "listMemory"]) {
      const first = await invoke(session, name, { project_id: projectId });
      assert.equal(first.status, 503);
      assert.match(first.body, new RegExp(`Simulated project ${name} failure`));
      const recovered = await rows(session, name);
      assert.equal(recovered.length, name === "listTasks" ? 4 : 2);
      assert.ok(
        recovered.every((row) => row.project_id === projectId && row.created_by === REVIEW_OWNER),
      );
      assert.deepEqual(await rows(session, name), recovered);
    }
    assert.equal((await rows(session, "listFiles")).length, 1);
    assert.equal((await rows(session, "listMembers")).length, 2);
    assert.deepEqual(await rows(session, "listInvites"), []);
    assert.equal(session.loading.pendingCount, 0);
  }
  const fresh = await createFixtureSession(pkg, { ...defaults, scenario: "project-list-recovery" });
  assert.equal((await invoke(fresh, "listTasks", { project_id: projectId })).status, 503);
  assert.equal((await invoke(fresh, "listMemory", { project_id: projectId })).status, 503);
});

test("Task status and delete fail once without mutation, then recover with their real contract", async () => {
  const session = await createFixtureSession(pkg, defaults);
  const original = await rows(session, "listTasks");
  assert.deepEqual(
    original.map(({ status }) => status),
    ["todo", "todo", "doing", "done"],
  );
  assert.match(original[0].title, /Sample/);
  const id = original[0].id;
  const change = { id, status: "done" };
  assert.equal((await mutate(session, "updateTask", change)).status, 503);
  assert.deepEqual(await rows(session, "listTasks"), original);
  success(await mutate(session, "updateTask", change));
  const done = (await rows(session, "listTasks")).find((task) => task.id === id);
  assert.equal(done.status, "done");
  assert.ok(done.completed_at);
  success(await mutate(session, "updateTask", { id, status: "doing" }));
  assert.equal(
    (await rows(session, "listTasks")).find((task) => task.id === id).completed_at,
    null,
  );
  assert.equal((await mutate(session, "deleteTask", { id })).status, 503);
  assert.equal((await rows(session, "listTasks")).length, 4);
  success(await mutate(session, "deleteTask", { id }));
  assert.deepEqual(
    (await rows(session, "listTasks")).map((task) => task.id),
    original.slice(1).map((task) => task.id),
  );
  assert.equal((await mutate(session, "deleteTask", { id })).status, 404);
  const fresh = await createFixtureSession(pkg, defaults);
  assert.deepEqual(await rows(fresh, "listTasks"), original);
  assert.equal((await mutate(fresh, "updateTask", change)).status, 503);
});

test("Reorder simulates one saved prefix, exposes latest local rows, then exact retry recovers", async () => {
  const session = await createFixtureSession(pkg, defaults);
  const original = await rows(session, "listTasks");
  const order = original.map((task) => task.id).reverse();
  const payload = { project_id: projectId, order };
  assert.equal((await mutate(session, "reorderTasks", payload)).status, 503);
  const reconciled = await rows(session, "listTasks");
  assert.equal(reconciled.find((task) => task.id === order[0]).position, 1);
  assert.equal(reconciled.find((task) => task.id === order[1]).position, 3);
  success(await mutate(session, "reorderTasks", payload));
  const recovered = await rows(session, "listTasks");
  assert.deepEqual(
    recovered.map((task) => task.id),
    order,
  );
  assert.deepEqual(
    recovered.map((task) => task.position),
    [1, 2, 3, 4],
  );
});

test("Memory add/delete preserves failed data and recovers only inside the same synthetic session", async () => {
  const session = await createFixtureSession(pkg, defaults);
  const original = await rows(session, "listMemory");
  const draft = "  Sample review draft with a clear next step.  ";
  assert.equal(
    (await mutate(session, "addMemory", { project_id: projectId, content: draft })).status,
    503,
  );
  assert.deepEqual(await rows(session, "listMemory"), original);
  const added = (await mutate(session, "addMemory", { project_id: projectId, content: draft })).json
    .result;
  assert.equal(added.content, draft.trim());
  assert.equal(added.created_by, REVIEW_OWNER);
  assert.equal((await rows(session, "listMemory"))[0].id, added.id);
  assert.equal((await mutate(session, "deleteMemory", { id: added.id })).status, 503);
  assert.equal((await rows(session, "listMemory")).length, 3);
  success(await mutate(session, "deleteMemory", { id: added.id }));
  assert.deepEqual(await rows(session, "listMemory"), original);
  const fresh = await createFixtureSession(pkg, defaults);
  assert.deepEqual(await rows(fresh, "listMemory"), original);
});

test("Member removal and revoke reuse only existing sample members and locally created pending invites", async () => {
  const session = await createFixtureSession(pkg, defaults);
  assert.equal(
    (await mutate(session, "removeMember", { project_id: projectId, user_id: REVIEW_OWNER }))
      .status,
    400,
  );
  assert.equal(
    (await mutate(session, "removeMember", { project_id: projectId, user_id: viewerId })).status,
    503,
  );
  assert.equal((await rows(session, "listMembers")).length, 2);
  success(await mutate(session, "removeMember", { project_id: projectId, user_id: viewerId }));
  assert.deepEqual(
    (await rows(session, "listMembers")).map((member) => member.user_id),
    [REVIEW_OWNER],
  );
  assert.equal(
    (await mutate(session, "removeMember", { project_id: projectId, user_id: viewerId })).status,
    400,
  );
  const absentId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  assert.equal((await mutate(session, "revokeInvite", { id: absentId })).status, 404);
  const invite = await mutate(session, "inviteMember", {
    project_id: projectId,
    email: "recovery@example.invalid",
    role: "viewer",
  });
  const id = invite.json.result.id;
  assert.equal((await mutate(session, "revokeInvite", { id })).status, 503);
  assert.equal((await rows(session, "listInvites"))[0].id, id);
  success(await mutate(session, "revokeInvite", { id }));
  assert.deepEqual(await rows(session, "listInvites"), []);
  assert.equal((await mutate(session, "revokeInvite", { id })).status, 404);
});

test("Project scope, known row IDs, method, malformed body and owner gates cannot consume failures", async () => {
  const session = await createFixtureSession(pkg, {
    ...defaults,
    scenario: "project-list-recovery",
  });
  for (const data of [
    { project_id: REVIEW_OWNER },
    { project_id: projectId, owner_id: REVIEW_OWNER },
  ])
    assert.equal((await invoke(session, "listTasks", data)).status, 400);
  assert.equal((await mutate(session, "listTasks", { project_id: projectId })).status, 405);
  assert.equal(
    (
      await invoke(session, "listTasks", { project_id: projectId }, "GET", {
        "x-kova-owner": viewerId,
      })
    ).status,
    401,
  );
  assert.equal(
    (await session.registry.dispatch({ url: serverURL("listTasks") + "?payload=not-json" })).status,
    400,
  );
  assert.equal((await invoke(session, "listTasks", { project_id: projectId })).status, 503);
  const tasks = await rows(session, "listTasks");
  const mutationSession = await createFixtureSession(pkg, defaults);
  for (const [name, data] of [
    ["updateTask", { id: tasks[0].id, title: "No arbitrary edits" }],
    ["updateTask", { id: viewerId, status: "doing" }],
    ["reorderTasks", { project_id: projectId, order: [tasks[0].id, tasks[0].id] }],
    ["reorderTasks", { project_id: projectId, order: tasks.map((task) => task.id).slice(1) }],
    ["deleteMemory", { id: viewerId }],
    ["addMemory", { project_id: projectId, content: "x".repeat(2001) }],
  ])
    assert.ok((await mutate(mutationSession, name, data)).status >= 400);
  assert.equal(
    (
      await mutate(mutationSession, "createTask", {
        project_id: projectId,
        title: "Outside sample",
      })
    ).status,
    503,
  );
  assert.equal(
    (await mutate(mutationSession, "updateTask", { id: tasks[0].id, status: "doing" })).status,
    503,
  );
  mutationSession.dispose();
  for (const [name, data, method] of [
    ["listTasks", { project_id: projectId }, "GET"],
    ["listMemory", { project_id: projectId }, "GET"],
    ["updateTask", { id: tasks[0].id, status: "doing" }, "POST"],
    ["removeMember", { project_id: projectId, user_id: viewerId }, "POST"],
    ["revokeInvite", { id: viewerId }, "POST"],
  ])
    assert.equal((await invoke(mutationSession, name, data, method)).status, 401);
});

test("Synthetic owner check follows existing project lifetime; unsupported routes stay closed", async () => {
  const session = await createFixtureSession(pkg, defaults);
  success(await mutate(session, "deleteProject", { id: projectId }));
  assert.equal((await invoke(session, "listTasks", { project_id: projectId })).status, 403);
  assert.equal((await invoke(session, "listMemory", { project_id: projectId })).status, 403);
  assert.equal(
    (
      await session.registry.dispatch({
        url: `${FIXTURE_ORIGIN}/_serverFn/${"f".repeat(64)}`,
        method: "POST",
      })
    ).status,
    503,
  );
  assert.equal(
    (await session.registry.dispatch({ url: "https://outside.invalid/unknown" })).status,
    503,
  );
  const ordinary = await createFixtureSession(pkg, { ...defaults, scenario: "default" });
  assert.deepEqual(await rows(ordinary, "listTasks"), []);
  assert.deepEqual(await rows(ordinary, "listMemory"), []);
});

test("Scenario labels and disclosure are wired to the ordinary controller", () => {
  const adapter = readFileSync(new URL("./private-http-review.mjs", import.meta.url), "utf8");
  assert.match(
    adapter,
    /REVIEW_STATE_OPTIONS\.map\(\(\{ id, label \}\) => \[id, label \?\? id\]\)/,
  );
  assert.match(adapter, /htmlEscape\(pkg\.state\.PROJECT_RECOVERY_REVIEW_DISCLOSURE \?\? ""\)/);
  assert.match(sourceState.PROJECT_RECOVERY_REVIEW_DISCLOSURE, /Reset discards all changes/);
  assert.match(sourceState.PROJECT_RECOVERY_REVIEW_DISCLOSURE, /no real backend or provider/);
  assert.match(
    sourceState.PROJECT_RECOVERY_REVIEW_DISCLOSURE,
    /first create a sample \.invalid invitation/,
  );
});

test("Sign-out during a local owner lookup blocks mutation and does not consume failure", async () => {
  let active = true;
  let release;
  let firstRead = true;
  const pendingOwner = new Promise((resolve) => {
    release = resolve;
  });
  const registry = new FixtureRegistry();
  const project = (
    await invoke(await createFixtureSession(pkg, defaults), "getProject", { id: projectId })
  ).json.result;
  await registry.route(
    `${FIXTURE_ORIGIN}/_serverFn/*`,
    sourceState.createProjectRecoveryReviewHandler(
      "project-mutation-recovery",
      "free",
      pkg.base.functionNames,
      {
        isActive: () => active,
        dispatch: async () => {
          if (firstRead) {
            firstRead = false;
            await pendingOwner;
          }
          return { json: { result: project, context: {} } };
        },
      },
    ),
  );
  const session = { registry };
  const payload = { id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001", status: "done" };
  const pending = mutate(session, "updateTask", payload);
  active = false;
  release();
  assert.equal((await pending).status, 401);
  active = true;
  assert.equal((await mutate(session, "updateTask", payload)).status, 503);
  success(await mutate(session, "updateTask", payload));
});

test("Memory capacity is bounded and non-owner project responses cannot grant access", async () => {
  const session = await createFixtureSession(pkg, defaults);
  const payload = { project_id: projectId, content: "Sample bounded addition" };
  assert.equal((await mutate(session, "addMemory", payload)).status, 503);
  for (let index = 0; index < 14; index++)
    assert.equal(
      (await mutate(session, "addMemory", payload)).json.result.content,
      payload.content,
    );
  assert.equal((await mutate(session, "addMemory", payload)).status, 413);
  assert.equal((await rows(session, "listMemory")).length, 16);
  for (const project of [
    { id: projectId, owner_id: REVIEW_OWNER, role: "viewer" },
    { id: projectId, owner_id: viewerId, role: "owner" },
  ]) {
    const registry = new FixtureRegistry();
    await registry.route(
      `${FIXTURE_ORIGIN}/_serverFn/*`,
      sourceState.createProjectRecoveryReviewHandler(
        "project-mutation-recovery",
        "free",
        pkg.base.functionNames,
        {
          isActive: () => true,
          dispatch: async () => ({ json: { result: project, context: {} } }),
        },
      ),
    );
    assert.equal((await invoke({ registry }, "listTasks", { project_id: projectId })).status, 403);
  }
});

test("project-create-uncertain is explicit signed-in HTTP review and keeps Check Projects reads unchanged", async () => {
  const scenario = "project-create-uncertain";
  const option = sourceState.REVIEW_STATE_OPTIONS.find((value) => value.id === scenario);
  assert.deepEqual(option.accounts, ["free", "plus", "pro"]);
  assert.equal(option.path, "/projects");
  assert.match(option.label, /no project created/);
  assert.match(sourceState.PROJECT_CREATE_UNCERTAIN_REVIEW_DISCLOSURE, /acknowledged retry/);
  await assert.rejects(sourceState.installReviewState({}, scenario, "free"), /private HTTP/);
  await assert.rejects(
    createFixtureSession(pkg, { ...defaults, scenario, account: "guest" }),
    /requires/,
  );
  for (const account of option.accounts) {
    const session = await createFixtureSession(pkg, { ...defaults, scenario, account });
    const before = (await invoke(session, "listProjects")).json.result;
    assert.ok(before.length > 0);
    const invites = (await invoke(session, "listMyPendingInvites")).json;
    for (let retry = 0; retry < 3; retry++) {
      const response = await mutate(session, "createProject", {
        name: "Fictional uncertain project",
        description: null,
      });
      assert.equal(response.status, 503);
      assert.equal(response.contentType, "text/plain");
      assert.equal(response.headers["Cache-Control"], "no-store");
      assert.match(response.body, /No project was created/);
      assert.equal(response.json, undefined);
      assert.deepEqual((await invoke(session, "listProjects")).json.result, before);
      assert.deepEqual((await invoke(session, "listMyPendingInvites")).json, invites);
    }
    const detail = await invoke(session, "getProject", { id: projectId });
    assert.equal(detail.json.result.id, projectId);
    session.dispose();
    assert.equal(
      (await mutate(session, "createProject", { name: "Fictional project" })).status,
      401,
    );
  }
});

test("uncertain create validates exact owner, method, field limits and closed Seroval envelope", async () => {
  const session = await createFixtureSession(pkg, {
    ...defaults,
    scenario: "project-create-uncertain",
  });
  assert.equal((await invoke(session, "createProject", { name: "Sample" }, "GET")).status, 405);
  for (const header of ["", "foreign"])
    assert.equal(
      (
        await invoke(session, "createProject", { name: "Sample" }, "POST", {
          "x-kova-owner": header,
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await invoke(
        session,
        "createProject",
        {
          name: " Sample ",
          description: null,
          system_prompt: "Fictional instructions",
          color: "blue",
        },
        "POST",
        { "x-kova-owner": REVIEW_OWNER },
      )
    ).status,
    503,
  );
  for (const data of [
    {},
    null,
    [],
    { name: " " },
    { name: "x".repeat(101) },
    { name: "Sample", description: "x".repeat(1001) },
    { name: "Sample", system_prompt: "x".repeat(4001) },
    { name: "Sample", color: "x".repeat(25) },
    { name: "Sample", owner_id: REVIEW_OWNER },
    { name: "Sample", description: 1 },
  ])
    assert.equal((await mutate(session, "createProject", data)).status, 400);
  const dispatch = (body, suffix = "", signal) =>
    session.registry.dispatch({
      url: serverURL("createProject") + suffix,
      method: "POST",
      body: Buffer.from(body),
      signal,
    });
  for (const body of [
    "{",
    "x".repeat(32769),
    JSON.stringify(toJSON({ data: { name: "Sample" }, context: { ownerId: REVIEW_OWNER } })),
    JSON.stringify(toJSON({ data: { name: "Sample" }, operation: "extra" })),
  ])
    assert.equal((await dispatch(body)).status, 400);
  const valid = JSON.stringify(toJSON({ data: { name: "Sample" }, context: {} }));
  assert.equal((await dispatch(valid, "?payload=other")).status, 400);
  const controller = new AbortController();
  controller.abort();
  assert.equal((await dispatch(valid, "", controller.signal)).status, 499);
  session.dispose();
});

test("uncertain create matches only the exact local createProject function and requires a verified manifest", async () => {
  const calls = [];
  const handler = sourceState.createProjectCreateUncertainReviewHandler(
    "free",
    pkg.base.functionNames,
    { isActive: () => true },
  );
  for (const url of [
    serverURL("listProjects"),
    serverURL("createProject").replace(FIXTURE_ORIGIN, "https://outside.invalid"),
    serverURL("createProject") + "/extra",
    FIXTURE_ORIGIN + "/api/projects",
  ]) {
    await handler({
      request: () => ({ url: () => url }),
      fallback: () => {
        calls.push(url);
      },
    });
  }
  assert.equal(calls.length, 4);
  assert.throws(
    () =>
      sourceState.createProjectCreateUncertainReviewHandler("free", new Map(), {
        isActive: () => true,
      }),
    /contract is missing/,
  );
  assert.throws(
    () => sourceState.createProjectCreateUncertainReviewHandler("free", pkg.base.functionNames),
    /Active synthetic/,
  );
});

test("default project creation remains successful and does not leak into uncertain scenario sessions", async () => {
  const regular = await createFixtureSession(pkg, { ...defaults, scenario: "default" });
  const uncertain = await createFixtureSession(pkg, {
    ...defaults,
    scenario: "project-create-uncertain",
  });
  const before = (await invoke(uncertain, "listProjects")).json.result;
  const created = await mutate(regular, "createProject", {
    name: "Default disposable success",
    description: null,
  });
  assert.ok(created.json.result.id);
  assert.ok(
    (await invoke(regular, "listProjects")).json.result.some(
      (project) => project.name === "Default disposable success",
    ),
  );
  assert.deepEqual((await invoke(uncertain, "listProjects")).json.result, before);
  assert.equal((await mutate(uncertain, "createProject", { name: "Still uncertain" })).status, 503);
  regular.dispose();
  uncertain.dispose();
});
