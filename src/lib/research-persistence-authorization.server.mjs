/**
 * Authorize every client-supplied relationship before a service-role client
 * persists a Deep Research run. This client must carry the caller's bearer
 * token so row-level security, rather than a caller-supplied user id, decides
 * which rows are visible.
 */

export class ResearchPersistenceAuthorizationError extends Error {
  constructor(code, status, publicMessage) {
    super(publicMessage);
    this.name = "ResearchPersistenceAuthorizationError";
    this.code = code;
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

function forbidden(code, publicMessage) {
  throw new ResearchPersistenceAuthorizationError(code, 403, publicMessage);
}

function unavailable() {
  throw new ResearchPersistenceAuthorizationError(
    "research_authorization_unavailable",
    503,
    "Research storage authorization is temporarily unavailable.",
  );
}

async function visibleRow(query) {
  let result;
  try {
    result = await query.maybeSingle();
  } catch {
    unavailable();
  }
  if (result?.error) unavailable();
  return result?.data ?? null;
}

/**
 * Returns only references proven visible to the authenticated caller.
 * Unknown rows and rows hidden by RLS intentionally produce the same 403.
 */
export async function authorizeResearchPersistence({ supabaseUser, chatId, projectId }) {
  let authorizedProjectId;
  let authorizedChatId;

  if (projectId) {
    const project = await visibleRow(
      supabaseUser.from("projects").select("id").eq("id", projectId),
    );
    if (project?.id !== projectId) {
      forbidden("research_project_forbidden", "The selected project is unavailable.");
    }
    authorizedProjectId = projectId;
  }

  if (chatId && authorizedProjectId) {
    const projectChat = await visibleRow(
      supabaseUser
        .from("project_chats")
        .select("id, project_id")
        .eq("id", chatId)
        .eq("project_id", authorizedProjectId),
    );
    if (projectChat?.id !== chatId || projectChat?.project_id !== authorizedProjectId) {
      forbidden("research_chat_forbidden", "The selected chat is unavailable.");
    }
    authorizedChatId = chatId;
  } else if (chatId) {
    const memoryChat = await visibleRow(
      supabaseUser.from("chat_memories").select("chat_id").eq("chat_id", chatId),
    );
    if (memoryChat?.chat_id !== chatId) {
      forbidden("research_chat_forbidden", "The selected chat is unavailable.");
    }
    authorizedChatId = chatId;
  }

  return {
    ...(authorizedChatId ? { chatId: authorizedChatId } : {}),
    ...(authorizedProjectId ? { projectId: authorizedProjectId } : {}),
  };
}
