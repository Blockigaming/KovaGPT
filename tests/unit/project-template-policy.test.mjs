import assert from "node:assert/strict";
import test from "node:test";

import {
  parseProjectTemplateMutation,
  parseProjectTemplateQuery,
  PROJECT_TEMPLATE_MAX_SNAPSHOT_BYTES,
  projectTemplateErrorStatus,
} from "../../src/lib/project-template-policy.mjs";

const mutationId = "11111111-1111-4111-8111-111111111111";
const templateId = "22222222-2222-4222-8222-222222222222";
const granteeUserId = "33333333-3333-4333-8333-333333333333";
const snapshot = {
  projectName: "Research plan",
  projectDescription: "A durable project",
  systemPrompt: "Use sources.\nCite evidence.",
  color: "#10a37f",
};

test("project template mutations normalize exact, bounded inputs", () => {
  assert.deepEqual(
    parseProjectTemplateMutation({
      action: "create",
      mutationId: mutationId.toUpperCase(),
      name: "  Research   template  ",
      description: "  Reusable setup  ",
      snapshot,
    }),
    {
      action: "create",
      mutationId,
      name: "Research template",
      description: "Reusable setup",
      snapshot,
    },
  );
  assert.deepEqual(
    parseProjectTemplateMutation({
      action: "share",
      mutationId,
      templateId,
      expectedRevision: 2,
      granteeUserId,
      canCopy: false,
    }),
    {
      action: "share",
      mutationId,
      templateId,
      expectedRevision: 2,
      granteeUserId,
      canCopy: false,
    },
  );
  assert.deepEqual(
    parseProjectTemplateMutation({
      action: "copy",
      mutationId,
      templateId,
    }),
    { action: "copy", mutationId, templateId, version: null },
  );
});

test("template snapshots reject unknown fields and oversized content", () => {
  assert.throws(
    () =>
      parseProjectTemplateMutation({
        action: "create",
        mutationId,
        name: "Unsafe",
        description: null,
        snapshot: { ...snapshot, accessToken: "must-never-be-stored" },
      }),
    /snapshot_invalid/u,
  );
  assert.throws(
    () =>
      parseProjectTemplateMutation({
        action: "create",
        mutationId,
        name: "Oversized",
        description: null,
        snapshot: { ...snapshot, systemPrompt: "x".repeat(PROJECT_TEMPLATE_MAX_SNAPSHOT_BYTES) },
      }),
    /system_prompt_invalid|snapshot_too_large/u,
  );
  assert.throws(
    () =>
      parseProjectTemplateMutation({
        action: "copy",
        mutationId,
        templateId,
        version: 0,
      }),
    /version_invalid/u,
  );
});

test("project template queries are strict and bounded", () => {
  assert.deepEqual(parseProjectTemplateQuery("https://kovagpt.com/api/project-templates"), {
    templateId: null,
    version: null,
    limit: 25,
    after: null,
  });
  assert.deepEqual(
    parseProjectTemplateQuery(
      `https://kovagpt.com/api/project-templates?templateId=${templateId}&version=3&limit=10`,
    ),
    { templateId, version: 3, limit: 10, after: null },
  );
  assert.throws(
    () => parseProjectTemplateQuery("https://kovagpt.com/api/project-templates?version=1"),
    /query_invalid/u,
  );
  assert.throws(
    () => parseProjectTemplateQuery("https://kovagpt.com/api/project-templates?limit=51"),
    /limit_invalid/u,
  );
  assert.throws(
    () => parseProjectTemplateQuery("https://kovagpt.com/api/project-templates?limit=2&limit=3"),
    /query_invalid/u,
  );
});

test("database errors map to stable HTTP status classes", () => {
  assert.equal(projectTemplateErrorStatus("40001"), 409);
  assert.equal(projectTemplateErrorStatus("P0002"), 404);
  assert.equal(projectTemplateErrorStatus("42501"), 403);
  assert.equal(projectTemplateErrorStatus("22023"), 400);
  assert.equal(projectTemplateErrorStatus("XX000"), 503);
});

test("management cursors are exact UUIDs and cannot be mixed with a version lookup", () => {
  assert.deepEqual(
    parseProjectTemplateQuery(
      `https://kovagpt.com/api/project-templates?limit=50&after=${templateId}`,
    ),
    {
      templateId: null,
      version: null,
      limit: 50,
      after: templateId,
    },
  );
  for (const query of [
    `after=no`,
    `after=${templateId}&after=${templateId}`,
    `templateId=${templateId}&after=${templateId}`,
  ]) {
    assert.throws(
      () => parseProjectTemplateQuery(`https://kovagpt.com/api/project-templates?${query}`),
      /cursor_invalid|query_invalid/u,
    );
  }
});
