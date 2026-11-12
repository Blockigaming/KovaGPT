import { createFileRoute } from "@tanstack/react-router";
import { TeamPage } from "@/components/TeamWorkspacePage";

export const Route = createFileRoute("/team")({ component: TeamPage });
