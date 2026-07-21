import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export type ToolContext = {
  token: string | null;
  userId: string | null;
  isAuthenticated: () => boolean;
  getToken: () => string;
  getUserId: () => string;
};

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type ToolDefinition<Input extends z.ZodRawShape> = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject<Input>;
  annotations?: Record<string, boolean>;
  handler: (input: z.infer<z.ZodObject<Input>>, ctx: ToolContext) => Promise<ToolResult>;
};

function contextFromRequest(request: Request): ToolContext {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  return {
    token,
    userId: null,
    isAuthenticated: () => Boolean(token),
    getToken: () => token ?? "",
    getUserId: () => "",
  };
}

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function authError(): ToolResult {
  return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
}

const tools = [
  {
    name: "list_projects",
    title: "List projects",
    description: "List the signed-in user's KovaGPT projects.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional() }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: async ({ limit }, ctx) => {
      if (!ctx.isAuthenticated()) return authError();
      const { data, error } = await supabaseForUser(ctx)
        .from("projects")
        .select("id, name, description, created_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(limit ?? 50);
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { projects: data ?? [] } };
    },
  },
  {
    name: "list_project_tasks",
    title: "List project tasks",
    description: "List tasks in one of the signed-in user's KovaGPT projects.",
    inputSchema: z.object({ project_id: z.string().uuid(), status: z.enum(["todo", "doing", "done"]).optional() }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: async ({ project_id, status }, ctx) => {
      if (!ctx.isAuthenticated()) return authError();
      let q = supabaseForUser(ctx)
        .from("project_tasks")
        .select("id, project_id, title, status, due_date, position, completed_at, created_at")
        .eq("project_id", project_id)
        .order("position", { ascending: true });
      if (status) q = q.eq("status", status);
      const { data, error } = await q;
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { tasks: data ?? [] } };
    },
  },
  {
    name: "create_project_task",
    title: "Create project task",
    description: "Create a new task in one of the signed-in user's KovaGPT projects.",
    inputSchema: z.object({ project_id: z.string().uuid(), title: z.string().trim().min(1), status: z.enum(["todo", "doing", "done"]).optional(), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    handler: async ({ project_id, title, status, due_date }, ctx) => {
      if (!ctx.isAuthenticated()) return authError();
      const { data, error } = await supabaseForUser(ctx)
        .from("project_tasks")
        .insert({ project_id, title, status: status ?? "todo", due_date: due_date ?? null, created_by: ctx.getUserId() || null })
        .select("id, project_id, title, status, due_date, created_at")
        .single();
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { task: data } };
    },
  },
  {
    name: "get_project_notes",
    title: "Get project notes",
    description: "Read the notes document for one of the signed-in user's KovaGPT projects.",
    inputSchema: z.object({ project_id: z.string().uuid() }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: async ({ project_id }, ctx) => {
      if (!ctx.isAuthenticated()) return authError();
      const { data, error } = await supabaseForUser(ctx).from("project_notes").select("project_id, content, updated_at").eq("project_id", project_id).maybeSingle();
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      return { content: [{ type: "text", text: data?.content ?? "" }], structuredContent: { notes: data } };
    },
  },
] satisfies ToolDefinition<z.ZodRawShape>[];

export function listTools() {
  return tools.map(({ name, title, description, inputSchema, annotations }) => ({
    name,
    title,
    description,
    inputSchema: z.toJSONSchema(inputSchema),
    annotations,
  }));
}

export async function invokeTool(request: Request, name: string): Promise<ToolResult> {
  const tool = tools.find((item) => item.name === name);
  if (!tool) return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  const body = await request.json().catch(() => ({}));
  const input = tool.inputSchema.safeParse((body as { input?: unknown }).input ?? body);
  if (!input.success) return { content: [{ type: "text", text: input.error.message }], isError: true };
  return tool.handler(input.data, contextFromRequest(request));
}
