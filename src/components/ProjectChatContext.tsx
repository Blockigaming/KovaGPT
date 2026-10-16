import { Link } from "@tanstack/react-router";

/** A read-only view of the already loaded project; it makes no context or provider calls. */
export function ProjectChatContext({
  projectId,
  project,
}: {
  projectId: string;
  project: { name: string; system_prompt: string | null } | null;
}) {
  return (
    <div className="space-y-5">
      <section aria-label="Saved project instructions">
        <h3 className="text-sm font-semibold">
          {project ? `${project.name} instructions` : "Project instructions"}
        </h3>
        <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6">
          {project
            ? project.system_prompt?.trim()
              ? project.system_prompt
              : "No project instructions were saved when this chat loaded."
            : "Project details are unavailable. Open the project to review its instructions."}
        </p>
      </section>
      <section aria-label="Project files and memory">
        <h3 className="text-sm font-semibold">Files and memory</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Replies can use saved project instructions and memory, plus relevant excerpts from indexed
          project files, when access and context retrieval are available. This view does not confirm
          which files or excerpts a particular reply used.
        </p>
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          className="mt-2 inline-flex min-h-11 items-center underline"
        >
          Review project instructions, files and memory
        </Link>
      </section>
      <p className="text-sm leading-6 text-muted-foreground">
        This composer sends text to the project conversation. Add files through the project; direct
        message attachments and agent selection are not available here.
      </p>
    </div>
  );
}
