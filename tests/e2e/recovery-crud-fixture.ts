import { createHash } from "node:crypto";
import {
  inspectProjectFile,
  normalizeProjectFileIdentity,
  ProjectFileInputError,
} from "../../src/lib/project-files-policy.mjs";
import type { Page, Request, Route } from "@playwright/test";
import { fromJSON } from "seroval";
import { coreFixture, reviewItems, reviewProject } from "./core-app-fixture";
import { functionNames, owner } from "./actual-app-fixture";

// Review-only, per-test in-memory mutations. Unmatched requests fall back to
// coreFixture's closed service responses; nothing is forwarded to a provider.
export const createdProjectId = "99999999-9999-4999-8999-999999999999";
type Operation =
  | "createProject"
  | "updateProject"
  | "deleteProject"
  | "deleteLibraryItem"
  | "renameLibrarySavedItem"
  | "inviteMember"
  | "revokeInvite"
  | "removeMember"
  | "updateMemberRole"
  | "createFolder"
  | "renameFolder"
  | "deleteFolder"
  | "moveItems"
  | "replaceText"
  | "listFiles"
  | "uploadFile"
  | "signFile"
  | "deleteFile";
type ReviewFile = {
  id: string;
  project_id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  kind: "file" | "image";
  created_at: string;
  signed_url: string | null;
};
type ReviewItem = Omit<(typeof reviewItems)[number], "folder_id"> & {
  folder_id: string | null;
  updated_at?: string;
};
type ReviewFolder = {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
};
type ReviewMember = {
  project_id: string;
  user_id: string;
  email: string;
  role: string;
  created_at: string;
};
type ReviewInvite = {
  id: string;
  project_id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  invited_by: string;
};
function serverData(request: Request): Record<string, unknown> {
  const raw =
    request.method() === "GET"
      ? new URL(request.url()).searchParams.get("payload")
      : request.postData();
  if (!raw) return {};
  // TanStack start-client-core serializes { data, context } through Seroval.
  const value = fromJSON(JSON.parse(raw)) as { data?: Record<string, unknown> };
  return value.data ?? {};
}

export async function recoveryCrudFixture(
  page: Page,
  theme: "light" | "dark" = "light",
  tier: "free" | "plus" | "pro" = "plus",
) {
  await coreFixture(page, theme, tier);
  const sampleBytes = Buffer.from(
    "Synthetic project file. No account records are included.\n",
    "utf8",
  );
  const sampleFileId = "77777777-7777-4777-8777-777777777777";
  const state = {
    projects: [structuredClone(reviewProject)],
    files: [
      {
        id: sampleFileId,
        project_id: reviewProject.id,
        name: "Sample project notes.txt",
        mime_type: "text/plain",
        size_bytes: sampleBytes.length,
        kind: "file",
        created_at: reviewProject.created_at,
        signed_url: null,
      },
    ] as ReviewFile[],
    fileBytes: new Map<string, Buffer>([[sampleFileId, sampleBytes]]),
    uploadDelayMs: 150,
    fileUploads: new Map<string, string>(),
    items: structuredClone(reviewItems) as ReviewItem[],
    folders: [] as ReviewFolder[],
    members: [
      {
        project_id: reviewProject.id,
        user_id: owner,
        email: "review@example.invalid",
        role: "owner",
        created_at: reviewProject.created_at,
      },
      {
        project_id: reviewProject.id,
        user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
        email: "collaborator@example.invalid",
        role: "viewer",
        created_at: reviewProject.created_at,
      },
    ] as ReviewMember[],
    invites: [] as ReviewInvite[],
    versions: new Map(
      reviewItems.map((item) => [
        item.id,
        [{ revision: item.content_revision, text: item.content_text }],
      ]),
    ),
    calls: [] as { operation: Operation; data: Record<string, unknown> }[],
    failNext: new Set<Operation>(),
  };
  let sequence = 1;
  const nextId = () => `88888888-8888-4888-8888-${String(sequence++).padStart(12, "0")}`;
  const fileLink = (file: ReviewFile) => {
    const version = createHash("sha256").update(state.fileBytes.get(file.id)!).digest("hex");
    return `http://127.0.0.1:4189/api/private-files?${new URLSearchParams({ kind: "project", id: file.id, owner, version })}`;
  };
  await page.route("**/_serverFn/**", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    const operation = (functionNames.get(id) ?? "").split("_")[0];
    const reply = (result: unknown) => route.fulfill({ json: { result, context: {} } });
    if (operation === "listProjects") return reply(state.projects);
    if (operation === "listFiles") {
      const data = serverData(route.request());
      if (state.failNext.delete("listFiles"))
        return route.fulfill({
          status: 503,
          contentType: "text/plain",
          body: "Synthetic file list unavailable. Retry.",
        });
      return reply(
        state.files
          .filter(
            (file) =>
              file.project_id === data.project_id &&
              (!data.kind || data.kind === "all" || file.kind === data.kind),
          )
          .map((file) => ({ ...file, signed_url: fileLink(file) })),
      );
    }
    if (operation === "listMembers" || operation === "listInvites") {
      const data = serverData(route.request());
      return reply(
        operation === "listMembers"
          ? state.members.filter((member) => member.project_id === data.project_id)
          : state.invites.filter(
              (invite) => invite.project_id === data.project_id && invite.status === "pending",
            ),
      );
    }
    if (operation === "getProject") {
      const data = serverData(route.request());
      return reply(state.projects.find((project) => project.id === data.id) ?? null);
    }
    if (
      ![
        "createProject",
        "updateProject",
        "deleteProject",
        "deleteLibraryItem",
        "renameLibrarySavedItem",
        "inviteMember",
        "revokeInvite",
        "removeMember",
        "updateMemberRole",
      ].includes(operation)
    )
      return route.fallback();
    const data = serverData(route.request());
    state.calls.push({ operation: operation as Operation, data });
    if (state.failNext.delete(operation as Operation))
      return route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "Synthetic review failure. Please retry.",
      });
    if (operation === "renameLibrarySavedItem") {
      const item = state.items.find((item) => item.id === data.id);
      if (
        route.request().method() !== "POST" ||
        (route.request().headers()["x-kova-owner"] &&
          route.request().headers()["x-kova-owner"] !== owner) ||
        data.expectedOwnerId !== owner ||
        !item ||
        data.generation !== item.content_generation ||
        data.previousTitle !== item.title ||
        typeof data.title !== "string" ||
        !data.title.trim() ||
        data.title.trim().length > 200
      )
        return route.fulfill({
          status: 409,
          json: { error: "The synthetic title change could not be confirmed. Refresh Library." },
        });
      item.title = data.title.trim();
      item.updated_at = new Date().toISOString();
      return reply({
        id: item.id,
        title: item.title,
        updated_at: item.updated_at,
        content_generation: item.content_generation,
      });
    }
    if (operation === "inviteMember") {
      if (
        !state.projects.some((project) => project.id === data.project_id) ||
        typeof data.email !== "string" ||
        !/^[^@\s]+@[^@\s]+\.invalid$/i.test(data.email) ||
        !["editor", "viewer"].includes(String(data.role))
      )
        return route.fulfill({
          status: 400,
          contentType: "text/plain",
          body: "Use a synthetic .invalid address and a sample project. No invitation is sent.",
        });
      const id = nextId();
      state.invites.push({
        id,
        project_id: String(data.project_id),
        email: data.email.toLowerCase(),
        role: String(data.role),
        status: "pending",
        created_at: reviewProject.created_at,
        invited_by: owner,
      });
      return reply({ id, auto_accepted: false });
    }
    if (operation === "revokeInvite") {
      const invite = state.invites.find((invite) => invite.id === data.id);
      if (!invite)
        return route.fulfill({
          status: 404,
          contentType: "text/plain",
          body: "Sample invitation not found.",
        });
      invite.status = "revoked";
      return reply({ ok: true });
    }
    if (operation === "removeMember" || operation === "updateMemberRole") {
      const member = state.members.find(
        (member) => member.project_id === data.project_id && member.user_id === data.user_id,
      );
      if (
        !member ||
        member.role === "owner" ||
        (operation === "updateMemberRole" && !["editor", "viewer"].includes(String(data.role)))
      )
        return route.fulfill({
          status: 400,
          contentType: "text/plain",
          body: "Invalid sample membership change.",
        });
      if (operation === "removeMember")
        state.members = state.members.filter((item) => item !== member);
      else member.role = String(data.role);
      return reply({ ok: true });
    }
    if (operation === "createProject") {
      if (typeof data.name !== "string" || !data.name.trim())
        throw new Error("Invalid fixture create contract");
      state.projects.push({
        ...reviewProject,
        id: createdProjectId,
        name: data.name,
        description: String(data.description ?? ""),
      });
      state.members.push({
        project_id: createdProjectId,
        user_id: owner,
        email: "review@example.invalid",
        role: "owner",
        created_at: reviewProject.created_at,
      });
      return reply({ id: createdProjectId });
    }
    if (operation === "updateProject") {
      const project = state.projects.find((project) => project.id === data.id);
      if (
        !project ||
        (data.name !== undefined && (typeof data.name !== "string" || !data.name.trim()))
      )
        throw new Error("Invalid fixture update contract");
      if (typeof data.name === "string") project.name = data.name;
      if (data.description !== undefined) project.description = String(data.description ?? "");
      if (data.system_prompt !== undefined)
        project.system_prompt = String(data.system_prompt ?? "");
      return reply({ ok: true });
    }
    if (operation === "deleteProject") {
      if (!state.projects.some((project) => project.id === data.id))
        throw new Error("Invalid fixture delete contract");
      state.projects = state.projects.filter((project) => project.id !== data.id);
      return reply({ ok: true });
    }
    const item = state.items.find((item) => item.id === data.id);
    if (
      !item ||
      data.expectedOwnerId !== owner ||
      data.contentGeneration !== item.content_generation ||
      data.revision !== item.content_revision
    )
      throw new Error("Library deletion must pin owner, generation and revision");
    state.items = state.items.filter((item) => item.id !== data.id);
    return reply({ ok: true });
  });
  await page.route("**/api/library/items**", async (route) => {
    const request = route.request();
    if (request.headers()["x-kova-owner"] !== owner)
      return route.fulfill({
        status: 401,
        json: { error: "Sample account changed. Reset the review context." },
      });
    if (request.method() === "GET") {
      const url = new URL(request.url());
      const item = state.items.find(
        (item) =>
          item.id === url.searchParams.get("id") &&
          item.content_generation === url.searchParams.get("generation"),
      );
      if (!item) return route.fulfill({ status: 404, json: { error: "Synthetic item not found" } });
      const versions = state.versions.get(item.id) ?? [];
      if (url.searchParams.get("history") === "1")
        return route.fulfill({
          json: {
            supported: true,
            versions: [...versions].reverse().map((version) => ({
              kind: "text",
              revision: version.revision,
              file_name: item.file_name,
              file_type: item.file_type,
              size_bytes: new TextEncoder().encode(version.text).length,
              created_at: item.created_at,
              current: version.revision === item.content_revision,
            })),
          },
        });
      const revision = url.searchParams.get("revision");
      const version = revision
        ? versions.find((version) => version.revision === Number(revision))
        : null;
      if (revision && !version)
        return route.fulfill({ status: 404, json: { error: "Sample revision not found" } });
      return route.fulfill({
        json: version
          ? { ...item, content_text: version.text, content_revision: version.revision }
          : item,
      });
    }
    const data = request.postDataJSON();
    if (data.operation === "replace_text") {
      state.calls.push({ operation: "replaceText", data });
      if (state.failNext.delete("replaceText"))
        return route.fulfill({
          status: 503,
          json: { error: "Synthetic version save failed. Retry preserves your draft." },
        });
      const item = state.items.find((item) => item.id === data.id);
      if (
        !item ||
        item.content_generation !== data.generation ||
        item.content_revision !== data.revision
      )
        return route.fulfill({
          status: 409,
          json: { error: "Refresh Library before changing this sample item." },
        });
      if (typeof data.text !== "string" || new TextEncoder().encode(data.text).length > 300000)
        return route.fulfill({ status: 400, json: { error: "Text must be 300 KB or smaller." } });
      item.content_revision += 1;
      item.content_text = data.text;
      state.versions.get(item.id)!.push({ revision: item.content_revision, text: data.text });
      return route.fulfill({ json: { revision: item.content_revision } });
    }
    if (data.operation !== "list") return route.fallback();
    return route.fulfill({
      json: {
        items: state.items.filter(
          (item) =>
            item.title.toLowerCase().includes(String(data.query ?? "").toLowerCase()) &&
            (!data.folder ||
              data.folder === "all" ||
              (data.folder === "unfiled" ? !item.folder_id : item.folder_id === data.folder)),
        ),
        cursor: null,
        hasMore: false,
      },
    });
  });
  await page.route("**/api/library/folders", async (route) => {
    if (route.request().headers()["x-kova-owner"] !== owner)
      return route.fulfill({ status: 401, json: { error: "sample_account_changed" } });
    const method = route.request().method();
    if (method === "GET") return route.fulfill({ json: { folders: state.folders } });
    const data = route.request().postDataJSON();
    const operation =
      method === "POST"
        ? "createFolder"
        : method === "PATCH"
          ? "renameFolder"
          : method === "DELETE"
            ? "deleteFolder"
            : null;
    if (!operation) return route.fallback();
    state.calls.push({ operation, data });
    if (state.failNext.delete(operation))
      return route.fulfill({ status: 503, json: { error: "synthetic_folder_failure" } });
    if (method === "DELETE") {
      const ids = new Set([String(data.id)]);
      if (!state.folders.some((folder) => ids.has(folder.id)))
        return route.fulfill({ status: 404, json: { error: "library_folder_not_found" } });
      let count: number;
      do {
        count = ids.size;
        state.folders.forEach((folder) => {
          if (folder.parentId && ids.has(folder.parentId)) ids.add(folder.id);
        });
      } while (count !== ids.size);
      const moved = state.items.filter((item) => item.folder_id && ids.has(item.folder_id));
      moved.forEach((item) => {
        item.folder_id = null;
      });
      state.folders = state.folders.filter((folder) => !ids.has(folder.id));
      return route.fulfill({
        json: { deletedFolderCount: ids.size, movedToRootCount: moved.length },
      });
    }
    if (
      typeof data.name !== "string" ||
      !data.name.trim() ||
      data.name.trim().length > 120 ||
      /[/\\]/.test(data.name)
    )
      return route.fulfill({ status: 400, json: { error: "invalid_folder_name" } });
    const existing =
      method === "PATCH" ? state.folders.find((folder) => folder.id === data.id) : null;
    if (method === "PATCH" && !existing)
      return route.fulfill({ status: 404, json: { error: "library_folder_not_found" } });
    const parentId = existing ? existing.parentId : (data.parentId ?? null);
    if (parentId && !state.folders.some((folder) => folder.id === parentId))
      return route.fulfill({ status: 404, json: { error: "library_folder_not_found" } });
    if (
      state.folders.some(
        (folder) =>
          folder !== existing &&
          folder.parentId === parentId &&
          folder.name.toLowerCase() === data.name.trim().toLowerCase(),
      )
    )
      return route.fulfill({ status: 409, json: { error: "library_folder_name_conflict" } });
    const folder = existing ?? {
      id: nextId(),
      name: "",
      parentId,
      position: state.folders.length,
      createdAt: reviewProject.created_at,
      updatedAt: reviewProject.created_at,
    };
    folder.name = data.name.trim();
    if (!existing) state.folders.push(folder);
    return route.fulfill({ json: { folder } });
  });
  await page.route("**/api/library/bulk-move", async (route) => {
    if (route.request().headers()["x-kova-owner"] !== owner)
      return route.fulfill({ status: 401, json: { error: "sample_account_changed" } });
    const data = route.request().postDataJSON();
    state.calls.push({ operation: "moveItems", data });
    if (state.failNext.delete("moveItems"))
      return route.fulfill({ status: 503, json: { error: "synthetic_move_failure" } });
    if (
      route.request().method() !== "POST" ||
      !Array.isArray(data.itemIds) ||
      !data.itemIds.length ||
      data.itemIds.length > 100 ||
      (data.folderId !== null && !state.folders.some((folder) => folder.id === data.folderId)) ||
      data.itemIds.some((id: unknown) => !state.items.some((item) => item.id === id))
    )
      return route.fulfill({ status: 404, json: { error: "library_item_or_folder_not_found" } });
    state.items.forEach((item) => {
      if (data.itemIds.includes(item.id)) item.folder_id = data.folderId;
    });
    return route.fulfill({ json: { movedCount: data.itemIds.length, folderId: data.folderId } });
  });
  await page.route("**/api/project-files**", async (route) => {
    const request = route.request(),
      headers = request.headers();
    if (headers["x-kova-owner"] !== owner)
      return route.fulfill({ status: 401, json: { error: "sample_account_changed" } });
    const method = request.method();
    const operation =
      method === "POST"
        ? "uploadFile"
        : method === "GET"
          ? "signFile"
          : method === "DELETE"
            ? "deleteFile"
            : null;
    if (!operation) return route.fallback();
    state.calls.push({ operation, data: { method } });
    if (operation === "uploadFile" && state.uploadDelayMs > 0)
      await new Promise((resolve) => setTimeout(resolve, Math.min(state.uploadDelayMs, 1000)));
    if (state.failNext.delete(operation))
      return route.fulfill({
        status: 503,
        json: {
          error:
            operation === "uploadFile"
              ? "project_file_storage_unavailable"
              : "project_file_sign_unavailable",
        },
      });
    if (method === "POST") {
      try {
        if (headers["content-type"] !== "application/octet-stream")
          return route.fulfill({ status: 415, json: { error: "unsupported_media_type" } });
        const projectId = normalizeProjectFileIdentity(headers["x-kova-project-id"]);
        const key = normalizeProjectFileIdentity(headers["x-kova-idempotency-key"]);
        if (!state.projects.some((project) => project.id === projectId))
          return route.fulfill({ status: 404, json: { error: "project_not_found" } });
        const bytes = request.postDataBuffer() ?? Buffer.alloc(0);
        let fileName;
        try {
          fileName = decodeURIComponent(headers["x-kova-file-name"] ?? "");
        } catch {
          throw new ProjectFileInputError(400, "invalid_file_name");
        }
        const metadata = inspectProjectFile({
          bytes,
          fileName,
          requestedKind: headers["x-kova-file-kind"] === "image" ? "image" : "file",
        });
        const previousId = state.fileUploads.get(`${projectId}:${key}`);
        if (previousId) {
          const previous = state.files.find((file) => file.id === previousId);
          if (
            !previous ||
            previous.name !== metadata.name ||
            !state.fileBytes.get(previousId)?.equals(bytes)
          )
            return route.fulfill({
              status: 409,
              json: { error: "project_file_upload_in_progress" },
            });
          return route.fulfill({ json: { file: { ...previous, status: "ready" } } });
        }
        const file: ReviewFile = {
          id: nextId(),
          project_id: projectId,
          name: metadata.name,
          mime_type: metadata.mimeType,
          size_bytes: bytes.length,
          kind: metadata.kind,
          created_at: reviewProject.created_at,
          signed_url: null,
        };
        state.files.push(file);
        state.fileBytes.set(file.id, Buffer.from(bytes));
        state.fileUploads.set(`${projectId}:${key}`, file.id);
        return route.fulfill({ status: 201, json: { file: { ...file, status: "ready" } } });
      } catch (error) {
        if (error instanceof ProjectFileInputError)
          return route.fulfill({ status: error.status, json: { error: error.code } });
        throw error;
      }
    }
    const id =
      method === "GET" ? new URL(request.url()).searchParams.get("id") : request.postDataJSON()?.id;
    const file = state.files.find(
      (file) => file.id === id && state.projects.some((project) => project.id === file.project_id),
    );
    if (!file) return route.fulfill({ status: 404, json: { error: "project_file_not_found" } });
    if (method === "GET")
      return route.fulfill({ json: { url: fileLink(file), expiresIn: 0, requiresSession: true } });
    state.files = state.files.filter((item) => item.id !== id);
    state.fileBytes.delete(file.id);
    return route.fulfill({ status: 204, body: "" });
  });
  const privateFile = async (route: Route) => {
    const url = new URL(route.request().url());
    const file = state.files.find(
      (file) =>
        file.id === url.searchParams.get("id") &&
        state.projects.some((project) => project.id === file.project_id),
    );
    if (
      route.request().method() !== "GET" ||
      url.searchParams.get("kind") !== "project" ||
      url.searchParams.get("owner") !== owner ||
      !file ||
      new URL(fileLink(file)).searchParams.get("version") !== url.searchParams.get("version")
    )
      return route.fulfill({ status: 404, body: "Sample file unavailable." });
    return route.fulfill({
      status: 200,
      contentType: file.mime_type,
      headers: {
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
      body: state.fileBytes.get(file.id)!,
    });
  };
  // Page handler covers previews; context handler covers the first popup request.
  await page.route("**/api/private-files?**", privateFile);
  await page.context().route("http://127.0.0.1:4189/api/private-files?**", privateFile);
  return state;
}
