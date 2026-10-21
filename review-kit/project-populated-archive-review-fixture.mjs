import { fromJSON } from "seroval";
import {
  PROJECT_ARCHIVE_REVIEW_OWNER as owner,
  PROJECT_ARCHIVE_REVIEW_ID as projectId,
  PROJECT_ARCHIVE_REVIEW_TIME as archivedAt,
} from "./project-archive-review-fixture.mjs";

export const PROJECT_POPULATED_ARCHIVE_REVIEW_OPTION = Object.freeze({
  id: "project-populated-archive-review",
  label: "project-populated-archive-review · long identity / retained chat and file / Restore only",
  accounts: Object.freeze(["free", "plus", "pro"]),
  path: `/projects/${projectId}`,
});
export const PROJECT_POPULATED_ARCHIVE_REVIEW_DISCLOSURE =
  "This separate fictional projection starts archived with a long project title and description, one retained sample conversation, the existing bundled project file and Context instructions. Notes and Collaboration read fixed empty fictional content; presence is disconnected. Restore clears only this projection's archived_at; every other mutation is denied even after Restore. The original default and project-archive-review fixtures stay unchanged. No real project, file, membership, provider or backend is read or changed. Reset discards this projection.";
export const PROJECT_POPULATED_ARCHIVE_CHAT_ID = "acacacac-acac-4cac-8cac-acacacacacac";
const origin = "http://127.0.0.1:4189";
const backendOrigin = "https://mfbycmbjygcfkrsuepxf.supabase.co";
const reads = new Set(["listProjects", "getProject", "listProjectChats", "getProjectChat"]);
const plain = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
function dataFor(request, url, name) {
  const method = request.method();
  if (
    [...url.searchParams.keys()].some((key) => method !== "GET" || key !== "payload") ||
    url.searchParams.getAll("payload").length > 1 ||
    (method === "GET" && request.postData())
  )
    throw new Error();
  const raw = method === "GET" ? url.searchParams.get("payload") : request.postData();
  if (name === "listProjects" && raw === null) return;
  if (typeof raw !== "string" || !raw || Buffer.byteLength(raw) > 8192) throw new Error();
  const envelope = fromJSON(JSON.parse(raw));
  if (
    !plain(envelope) ||
    Object.keys(envelope).some((key) => !["data", "context"].includes(key)) ||
    (envelope.context !== undefined &&
      (!plain(envelope.context) || Object.keys(envelope.context).length))
  )
    throw new Error();
  const data = envelope.data;
  if (name === "listProjects") {
    if (data !== undefined && (!plain(data) || Object.keys(data).length)) throw new Error();
    return;
  }
  const key = name === "listProjectChats" ? "project_id" : "id";
  const restoring = name === "setProjectArchived";
  if (
    !plain(data) ||
    Object.keys(data).length !== (restoring ? 2 : 1) ||
    typeof data[key] !== "string" ||
    Object.keys(data).some((field) => ![key, ...(restoring ? ["archived"] : [])].includes(field)) ||
    (restoring && data.archived !== false)
  )
    throw new Error();
  return data;
}

export function createProjectPopulatedArchiveReviewHandler(
  functionNames,
  { isActive, getProjects, expectedAccessToken } = {},
) {
  if (
    !(functionNames instanceof Map) ||
    typeof isActive !== "function" ||
    typeof getProjects !== "function" ||
    typeof expectedAccessToken !== "string" ||
    !expectedAccessToken
  )
    throw new Error("Existing project, manifest and active synthetic session required.");
  for (const name of [...reads, "setProjectArchived", "listFiles"])
    if (![...functionNames.values()].some((value) => value.split("_")[0] === name))
      throw new Error(`Packaged populated archive contract is missing ${name}.`);
  const baseline = getProjects()?.find((row) => row.id === projectId);
  if (
    isActive() !== true ||
    baseline?.owner_id !== owner ||
    baseline.role !== "owner" ||
    baseline.archived_at ||
    baseline.deletion_requested_at
  )
    throw new Error("The unchanged active synthetic owner project is required.");
  const project = {
    ...structuredClone(baseline),
    name: "Fictional research archive with a deliberately long project title for narrow-screen review",
    description:
      "Retained fictional research notes, a sample conversation and the existing bundled project file remain visible while this archived project is read-only. This long description checks wrapping next to project identity and role controls.",
    system_prompt:
      "Retained fictional Context: use only the supplied sample project material, keep the long project identity visible and cite the existing bundled notes when relevant. No generation is connected.",
    archived_at: archivedAt,
    chat_count: 1,
    file_count: 1,
  };
  const chat = {
    id: PROJECT_POPULATED_ARCHIVE_CHAT_ID,
    project_id: projectId,
    title:
      "Retained fictional conversation with a long research question and preserved project membership",
    updated_at: "2026-10-16T10:00:00.000Z",
    created_by: owner,
    snapshot: {
      messages: [
        {
          role: "user",
          content: "Keep this fictional conversation visible after project archival.",
        },
        {
          role: "assistant",
          content:
            "Retained fictional response. Archival keeps this conversation and the bundled project notes readable. Restore changes only this sample project's archive flag; no generation or live write occurs.",
        },
      ],
    },
  };
  return async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      method = request.method();
    const server = /^\/_serverFn\/[^/]+$/.test(url.pathname);
    const projectApi = /^\/api\/(?:project[^/]*|private-files)(?:\/|$)/.test(url.pathname);
    const backend =
      /^\/rest\/v1\/(?:projects|project_[^/]+|rpc\/[^/]*project[^/]*)$/.test(url.pathname) ||
      url.pathname.startsWith("/storage/v1/");
    const collaboration = url.pathname === "/rest/v1/rpc/collaboration_rpc";
    if (!server && !projectApi && !backend && !collaboration) return route.fallback();
    const fail = (status, error) =>
      route.fulfill({ status, json: { error }, headers: { "Cache-Control": "no-store" } });
    if (collaboration ? url.origin !== backendOrigin : !backend && url.origin !== origin)
      return fail(400, "Use the exact local archive review endpoint.");
    const headers = request.headers();
    if (
      isActive() !== true ||
      (Object.hasOwn(headers, "x-kova-owner") && headers["x-kova-owner"] !== owner)
    )
      return fail(401, "Synthetic populated archive account changed.");
    if (request.signal?.()?.aborted) return fail(499, "Synthetic archive request canceled.");
    if (collaboration) {
      if (headers.authorization !== `Bearer ${expectedAccessToken}`)
        return fail(401, "Synthetic populated archive token changed.");
      if (method !== "POST") return fail(405, "Use the exact collaboration read method.");
      if (url.search || url.hash) return fail(400, "Use the exact collaboration read endpoint.");
      if (headers["content-type"]?.split(";", 1)[0] !== "application/json")
        return fail(415, "JSON is required for the synthetic collaboration read.");
      const raw = request.postData();
      if (typeof raw !== "string" || Buffer.byteLength(raw) > 8192)
        return fail(413, "Synthetic collaboration payload is too large.");
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return fail(400, "Use the exact bounded collaboration read payload.");
      }
      if (
        !plain(body) ||
        Object.keys(body).length !== 2 ||
        !Object.hasOwn(body, "p_operation") ||
        !Object.hasOwn(body, "p_data") ||
        !plain(body.p_data) ||
        Object.keys(body.p_data).length !== 1 ||
        !Object.hasOwn(body.p_data, "projectId")
      )
        return fail(400, "Use the exact bounded collaboration read payload.");
      if (body.p_data.projectId !== projectId)
        return fail(404, "Only the fixed populated archive identity is available.");
      if (!["note_get", "project_comments"].includes(body.p_operation))
        return fail(405, "Only fixed Notes and Collaboration reads are connected.");
      return route.fulfill({
        status: 200,
        json:
          body.p_operation === "note_get"
            ? { project_id: projectId, content: "", revision: 0 }
            : [],
        headers: { "Cache-Control": "no-store" },
      });
    }
    const name = server
      ? (functionNames.get(url.pathname.split("/").at(-1)) ?? "").split("_")[0]
      : "";
    if (backend || (method !== "GET" && !(name === "setProjectArchived" && method === "POST")))
      return fail(405, "Only Restore of this fixed synthetic project is writable.");
    if (!server) return route.fallback();
    if (!reads.has(name) && name !== "setProjectArchived")
      return /^(?:get|list|search|is|can)[A-Z]/.test(name)
        ? route.fallback()
        : fail(405, "Only named archive reads and Restore are available.");
    if (method !== (name === "setProjectArchived" ? "POST" : "GET"))
      return fail(405, "Unsupported synthetic populated archive method.");
    let data;
    try {
      data = dataFor(request, url, name);
    } catch {
      return fail(400, "Use the exact bounded archive read or Restore payload.");
    }
    const expected = name === "getProjectChat" ? chat.id : projectId;
    if (
      name !== "listProjects" &&
      data[name === "listProjectChats" ? "project_id" : "id"] !== expected
    )
      return fail(404, "Only the fixed populated archive identity is available.");
    if (name === "setProjectArchived") project.archived_at = null;
    const { project_id, snapshot, ...summary } = chat;
    const result =
      name === "setProjectArchived"
        ? { ok: true }
        : name === "listProjects"
          ? [project]
          : name === "getProject"
            ? project
            : name === "listProjectChats"
              ? [summary]
              : chat;
    return route.fulfill({
      status: 200,
      json: { result: structuredClone(result), context: {} },
      headers: { "Cache-Control": "no-store" },
    });
  };
}
