import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "create_project_task",
  title: "Create project task",
  description: "Create a new task in one of the signed-in user's KovaGPT projects.",
  inputSchema: {
    project_id: z.string().uuid().describe("The project ID."),
    title: z.string().trim().min(1).describe("Task title."),
    status: z.enum(["todo", "doing", "done"]).optional().describe("Initial status (defaults to todo)."),
    due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Optional due date in YYYY-MM-DD."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ project_id, title, status, due_date }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const { data, error } = await supabaseForUser(ctx)
      .from("project_tasks")
      .insert({
        project_id,
        title,
        status: status ?? "todo",
        due_date: due_date ?? null,
        created_by: ctx.getUserId(),
      })
      .select("id, project_id, title, status, due_date, created_at")
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { task: data },
    };
  },
});
