/**
 * Server-side assembly of per-chat workspace context.
 *
 * Two things live here, and both are deliberately server-only:
 *   1. Per-chat custom rules (chat_custom_rules) — the client never gets to
 *      inject its own rules text; we read the owner's stored row instead.
 *   2. Pinned-file context (chat_pinned_files) — resolved to already-extracted
 *      text for sources the caller still owns/can access, clamped to a bounded
 *      character budget with explicit truncation disclosure.
 *
 * Precedence is fixed and documented for the model: global user settings, then
 * project instructions, then chat-specific rules (narrowest scope wins).
 */

import {
  MAX_PINNED_CONTEXT_CHARS,
  MAX_PINNED_ITEM_CHARS,
  MAX_PINS_PER_CHAT,
  MAX_RULES_LENGTH,
  budgetPinnedContext,
  describePinStatus,
  type PinStatus,
} from "@/lib/chat-workspace-contract.mjs";

/** Minimal shape of the admin/service client this module needs. */
export type WorkspaceQueryClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: unknown,
      ) => {
        eq: (column: string, value: unknown) => Record<string, unknown>;
        order?: unknown;
        limit?: unknown;
        maybeSingle?: unknown;
      };
    };
  };
  rpc?: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }>;
};

type Row = Record<string, unknown>;

/**
 * Minimal chainable shape of a Supabase query builder. Awaiting it yields
 * `{ data, error }`, which `runQuery` normalizes.
 */
type QueryBuilderLike = {
  select: (columns: string) => QueryBuilderLike;
  eq: (column: string, value: unknown) => QueryBuilderLike;
  in: (column: string, values: unknown[]) => QueryBuilderLike;
  order: (column: string, options?: { ascending?: boolean }) => QueryBuilderLike;
  limit: (count: number) => QueryBuilderLike;
  maybeSingle: () => QueryBuilderLike;
};

async function runQuery(builder: unknown): Promise<Row[]> {
  const result = (await builder) as { data?: unknown; error?: unknown } | null;
  const data = result?.data;
  if (!Array.isArray(data)) return data && typeof data === "object" ? [data as Row] : [];
  return data as Row[];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export type ChatRulesResult = {
  /** Rules text to honor, already trimmed and length-clamped. */
  instructions: string;
  /** True when a row exists and is enabled (drives the UI disclosure badge). */
  active: boolean;
  /** True when a row exists but the owner switched it off. */
  disabled: boolean;
};

/**
 * Load the caller's rules for one chat. Temporary chats intentionally skip
 * persisted rules so a throwaway conversation cannot be steered by old state.
 */
export async function loadChatCustomRules(
  client: unknown,
  args: { userId: string; chatId: string; temporary?: boolean },
): Promise<ChatRulesResult> {
  const empty: ChatRulesResult = { instructions: "", active: false, disabled: false };
  if (!args.userId || !args.chatId || args.temporary) return empty;

  const supabase = client as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (
          c: string,
          v: unknown,
        ) => { eq: (c: string, v: unknown) => { limit: (n: number) => unknown } };
      };
    };
  };

  const rows = await runQuery(
    supabase
      .from("chat_custom_rules")
      .select("instructions, enabled")
      .eq("owner_id", args.userId)
      .eq("chat_id", args.chatId)
      .limit(1),
  );
  const row = rows[0];
  if (!row) return empty;

  const enabled = row["enabled"] !== false;
  const instructions = str(row["instructions"]).trim().slice(0, MAX_RULES_LENGTH);
  if (!enabled) return { instructions: "", active: false, disabled: true };
  if (!instructions) return empty;
  return { instructions, active: true, disabled: false };
}

export type ResolvedPin = {
  pinId: string;
  sourceType: "library" | "project_file";
  sourceId: string;
  projectId: string | null;
  status: PinStatus;
  name: string;
  content: string;
};

export type PinnedContextResult = {
  items: (ResolvedPin & { truncated: boolean; includedChars: number })[];
  unavailable: { name: string; status: PinStatus; statusLabel: string }[];
  usedChars: number;
  truncated: boolean;
  skippedCount: number;
};

/**
 * Resolve pinned files for one chat into bounded prompt text.
 *
 * Ownership is enforced twice: pins are read by `owner_id`, and each source is
 * re-checked (library rows by `user_id`, project files by project membership)
 * so a stale pin can never leak another user's or a revoked project's content.
 */
export async function loadPinnedContext(
  client: unknown,
  args: {
    userId: string;
    chatId: string;
    temporary?: boolean;
    totalChars?: number;
  },
): Promise<PinnedContextResult> {
  const empty: PinnedContextResult = {
    items: [],
    unavailable: [],
    usedChars: 0,
    truncated: false,
    skippedCount: 0,
  };
  if (!args.userId || !args.chatId || args.temporary) return empty;

  // Structural view over the generated Supabase client: this module only needs
  // a chainable query builder, not the full generated table typings.
  const supabase = client as {
    from: (table: string) => QueryBuilderLike;
    rpc?: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown }>;
  };

  const pins = await runQuery(
    supabase
      .from("chat_pinned_files")
      .select("id, source_type, source_id, project_id, status")
      .eq("owner_id", args.userId)
      .eq("chat_id", args.chatId)
      .order("created_at", { ascending: true })
      .limit(MAX_PINS_PER_CHAT),
  );
  if (pins.length === 0) return empty;

  const membershipCache = new Map<string, boolean>();
  const resolved: ResolvedPin[] = [];

  for (const pin of pins) {
    const sourceType = str(pin["source_type"]) === "project_file" ? "project_file" : "library";
    const base = {
      pinId: str(pin["id"]),
      sourceType: sourceType as "library" | "project_file",
      sourceId: str(pin["source_id"]),
      projectId: typeof pin["project_id"] === "string" ? (pin["project_id"] as string) : null,
    };

    if (sourceType === "library") {
      const rows = await runQuery(
        supabase
          .from("user_library_items")
          .select("id, title, file_name, content_text")
          .eq("user_id", args.userId)
          .eq("id", base.sourceId)
          .limit(1),
      );
      const item = rows[0];
      if (!item) {
        resolved.push({ ...base, status: "deleted", name: "Removed item", content: "" });
        continue;
      }
      const text = str(item["content_text"]);
      resolved.push({
        ...base,
        status: text ? "active" : "indexing",
        name: str(item["title"]) || str(item["file_name"]) || "Library item",
        content: text,
      });
      continue;
    }

    // Project files: membership is authoritative, not the stored project_id.
    const projectId = base.projectId ?? "";
    if (!projectId) {
      resolved.push({ ...base, status: "permission_lost", name: "Unavailable file", content: "" });
      continue;
    }
    let isMember = membershipCache.get(projectId);
    if (isMember === undefined) {
      try {
        const res = await supabase.rpc?.("is_project_member", {
          _user_id: args.userId,
          _project_id: projectId,
        });
        isMember = res?.data === true;
      } catch {
        isMember = false;
      }
      membershipCache.set(projectId, isMember);
    }
    if (!isMember) {
      resolved.push({ ...base, status: "permission_lost", name: "Unavailable file", content: "" });
      continue;
    }

    const fileRows = await runQuery(
      supabase
        .from("project_files")
        .select("id, name")
        .eq("project_id", projectId)
        .eq("status", "ready")
        .eq("id", base.sourceId)
        .limit(1),
    );
    const file = fileRows[0];
    if (!file) {
      resolved.push({ ...base, status: "deleted", name: "Deleted file", content: "" });
      continue;
    }
    const chunks = await runQuery(
      supabase
        .from("project_file_chunks")
        .select("content, chunk_index")
        .eq("project_id", projectId)
        .eq("file_id", base.sourceId)
        .order("chunk_index", { ascending: true })
        .limit(12),
    );
    const text = chunks
      .map((chunk) => str(chunk["content"]))
      .filter(Boolean)
      .join("\n\n");
    resolved.push({
      ...base,
      status: text ? "active" : "indexing",
      name: str(file["name"]) || "Project file",
      content: text,
    });
  }

  const budgeted = budgetPinnedContext(resolved as never, {
    totalChars: Math.min(args.totalChars ?? MAX_PINNED_CONTEXT_CHARS, MAX_PINNED_CONTEXT_CHARS),
    itemChars: MAX_PINNED_ITEM_CHARS,
    maxItems: MAX_PINS_PER_CHAT,
  });

  const items = budgeted.items as unknown as (ResolvedPin & {
    truncated: boolean;
    includedChars: number;
  })[];

  return {
    items: items.filter((item) => item.status === "active"),
    unavailable: items
      .filter((item) => item.status !== "active")
      .map((item) => ({
        name: item.name,
        status: item.status,
        statusLabel: describePinStatus(item.status),
      })),
    usedChars: budgeted.usedChars,
    truncated: budgeted.truncated,
    skippedCount: budgeted.skippedCount,
  };
}

/**
 * Render the chat-scoped block that is appended to the authoritative system
 * prompt. Returns "" when there is nothing truthful to say.
 */
export function renderChatWorkspaceBlock(input: {
  rules: ChatRulesResult;
  pinned: PinnedContextResult;
}): string {
  const parts: string[] = [];

  if (input.rules.active && input.rules.instructions) {
    parts.push(
      "Rules for this chat (set by the user; these take precedence over global settings and project instructions when they conflict):\n" +
        input.rules.instructions,
    );
  }

  if (input.pinned.items.length > 0) {
    const rendered = input.pinned.items
      .map(
        (item, index) =>
          `[Pinned file ${index + 1}: ${item.name}${item.truncated ? " — truncated to fit" : ""}]\n${item.content}`,
      )
      .join("\n\n");
    parts.push(
      "Files the user pinned to this chat. Treat them as ground truth for questions they cover, and never invent content that is not present:\n" +
        rendered,
    );
  }

  if (input.pinned.truncated || input.pinned.skippedCount > 0) {
    parts.push(
      `Note: pinned file content was shortened to stay within the context budget${
        input.pinned.skippedCount > 0
          ? ` and ${input.pinned.skippedCount} pinned file(s) were left out entirely`
          : ""
      }. If the answer depends on a part you cannot see, say so instead of guessing.`,
    );
  }

  if (input.pinned.unavailable.length > 0) {
    parts.push(
      "Pinned files that could not be read right now (tell the user plainly if they matter):\n" +
        input.pinned.unavailable.map((item) => `- ${item.name}: ${item.statusLabel}`).join("\n"),
    );
  }

  if (parts.length === 0) return "";
  return `\n\n--- CHAT WORKSPACE ---\n${parts.join("\n\n")}\n--- END CHAT WORKSPACE ---`;
}

/** Convenience wrapper used by the chat route. Never throws. */
export async function buildChatWorkspaceBlock(
  client: unknown,
  args: { userId: string; chatId: string; temporary?: boolean; totalChars?: number },
): Promise<{ block: string; rulesActive: boolean; pinnedCount: number; truncated: boolean }> {
  try {
    const [rules, pinned] = await Promise.all([
      loadChatCustomRules(client, args),
      loadPinnedContext(client, args),
    ]);
    return {
      block: renderChatWorkspaceBlock({ rules, pinned }),
      rulesActive: rules.active,
      pinnedCount: pinned.items.length,
      truncated: pinned.truncated,
    };
  } catch {
    return { block: "", rulesActive: false, pinnedCount: 0, truncated: false };
  }
}
