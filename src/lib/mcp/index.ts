import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listProjectsTool from "./tools/list-projects";
import listProjectTasksTool from "./tools/list-project-tasks";
import createProjectTaskTool from "./tools/create-project-task";
import getProjectNotesTool from "./tools/get-project-notes";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "kovagpt-mcp",
  title: "KovaGPT",
  version: "0.1.0",
  instructions:
    "Tools for the signed-in KovaGPT user's projects. Use `list_projects` to discover project IDs, then read notes and tasks or create new tasks. All calls act as the authorized user and respect their KovaGPT permissions.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listProjectsTool, listProjectTasksTool, createProjectTaskTool, getProjectNotesTool],
});
