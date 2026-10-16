import { z } from "zod";

const text = z.string().min(1).max(8000);
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const number = z.number().int().positive().safe();
const ref = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !/[\s~^:?*[\\]|\.\.|@\{|\/\/|^\/|\/$|\.$|\.lock$/.test(value));
const path = z
  .string()
  .min(1)
  .max(1000)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value.split("/").some((part) => part === ".." || part === "." || !part),
  );
const names = z.array(z.string().regex(/^[a-zA-Z0-9-]{1,100}$/)).max(50);
const empty = z.object({}).strict();
const state = z.object({ state: z.enum(["open", "closed", "all"]).default("open") }).strict();
export const githubWriteSchemas = {
  createIssue: z
    .object({
      title: text.max(256),
      body: text.optional(),
      labels: z.array(text.max(100)).max(50).optional(),
      assignees: names.optional(),
    })
    .strict(),
  commentIssue: z.object({ number, body: text }).strict(),
  createBranch: z.object({ name: ref, sha }).strict(),
  openPull: z
    .object({
      title: text.max(256),
      body: text.optional(),
      head: ref,
      base: ref,
      draft: z.boolean().default(true),
    })
    .strict(),
  requestReview: z.object({ number, reviewers: names.min(1) }).strict(),
  mergePull: z
    .object({
      number,
      input: z
        .object({
          sha,
          merge_method: z.enum(["merge", "squash", "rebase"]),
          commit_title: text.max(256).optional(),
          commit_message: text.optional(),
        })
        .strict(),
    })
    .strict(),
  proposePatch: z
    .object({
      branch: ref,
      parentSha: sha,
      baseTree: sha,
      message: text,
      files: z
        .array(z.object({ path, content: z.string().max(32000) }).strict())
        .min(1)
        .max(20),
    })
    .strict(),
};
export const githubReadSchemas = {
  file: z.object({ path, ref: ref.optional() }).strict(),
  tree: z.object({ ref: ref.optional() }).strict(),
  branches: empty,
  commits: empty,
  issues: state,
  pulls: state,
  releases: empty,
  workflows: empty,
  workflowRuns: empty,
  checks: z.object({ ref }).strict(),
  discussions: empty,
  searchCode: z
    .object({ query: text.max(500).refine((value) => !/\b(?:repo|org|user):|\bOR\b/i.test(value)) })
    .strict(),
};
export const githubActionId = z.string().uuid();
export function parseGitHubTool(input: unknown) {
  const request = z
    .object({
      tool: z.string(),
      repository: z
        .string()
        .regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)
        .max(250)
        .transform((value) => value.toLowerCase()),
      args: z.record(z.string(), z.unknown()).default({}),
    })
    .strict()
    .parse(input);
  const write = Object.hasOwn(githubWriteSchemas, request.tool);
  const schemas = write ? githubWriteSchemas : githubReadSchemas;
  if (!Object.hasOwn(schemas, request.tool)) throw new Error("Unknown GitHub tool");
  const schema = schemas[request.tool as keyof typeof schemas] as z.ZodType;
  return { ...request, args: schema.parse(request.args) as Record<string, unknown>, write };
}
