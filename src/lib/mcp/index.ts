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

<<<<<<< HEAD
async function userIdFromToken(token: string | null): Promise<string | null> {
  if (!token) return null;
  const supabaseUrl = process.env.SUPABASE_URL;
  const authKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !authKey) return null;
  const supabase = createClient(supabaseUrl, authKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.id) return null;
  return data.user.id;
}

async function contextFromRequest(request: Request): Promise<ToolContext> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  const userId = await userIdFromToken(token);
  return {
    token,
    userId,
    isAuthenticated: () => Boolean(token && userId),
    getToken: () => token ?? "",
    getUserId: () => userId ?? "",
=======
function contextFromRequest(request: Request): ToolContext {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  return {
    token,
    userId: null,
    isAuthenticated: () => Boolean(token),
    getToken: () => token ?? "",
    getUserId: () => "",
>>>>>>> origin/main
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
<<<<<<< HEAD
        .limit(typeof limit === "number" ? limit : 50);
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: { projects: data ?? [] },
      };
=======
        .limit(limit ?? 50);
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { projects: data ?? [] } };
>>>>>>> origin/main
    },
  },
  {
    name: "list_project_tasks",
    title: "List project tasks",
    description: "List tasks in one of the signed-in user's KovaGPT projects.",
<<<<<<< HEAD
    inputSchema: z.object({
      project_id: z.string().uuid(),
      status: z.enum(["todo", "doing", "done"]).optional(),
    }),
=======
    inputSchema: z.object({ project_id: z.string().uuid(), status: z.enum(["todo", "doing", "done"]).optional() }),
>>>>>>> origin/main
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
<<<<<<< HEAD
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: { tasks: data ?? [] },
      };
=======
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { tasks: data ?? [] } };
>>>>>>> origin/main
    },
  },
  {
    name: "create_project_task",
    title: "Create project task",
    description: "Create a new task in one of the signed-in user's KovaGPT projects.",
<<<<<<< HEAD
    inputSchema: z.object({
      project_id: z.string().uuid(),
      title: z.string().trim().min(1),
      status: z.enum(["todo", "doing", "done"]).optional(),
      due_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    handler: async ({ project_id, title, status, due_date }, ctx) => {
      if (!ctx.isAuthenticated()) return authError();
      const userId = ctx.getUserId();
      if (!userId) return authError();
      const { data, error } = await supabaseForUser(ctx)
        .from("project_tasks")
        .insert({
          project_id,
          title,
          status: status ?? "todo",
          due_date: due_date ?? null,
          created_by: userId,
        })
        .select("id, project_id, title, status, due_date, created_at")
        .single();
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: { task: data },
      };
=======
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
>>>>>>> origin/main
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
<<<<<<< HEAD
      const { data, error } = await supabaseForUser(ctx)
        .from("project_notes")
        .select("project_id, content, updated_at")
        .eq("project_id", project_id)
        .maybeSingle();
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      return {
        content: [{ type: "text", text: data?.content ?? "" }],
        structuredContent: { notes: data },
      };
=======
      const { data, error } = await supabaseForUser(ctx).from("project_notes").select("project_id, content, updated_at").eq("project_id", project_id).maybeSingle();
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      return { content: [{ type: "text", text: data?.content ?? "" }], structuredContent: { notes: data } };
>>>>>>> origin/main
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
<<<<<<< HEAD
  if (!input.success)
    return { content: [{ type: "text", text: input.error.message }], isError: true };
  return tool.handler(input.data, await contextFromRequest(request));
=======
  if (!input.success) return { content: [{ type: "text", text: input.error.message }], isError: true };
  return tool.handler(input.data, contextFromRequest(request));
>>>>>>> origin/main
}
