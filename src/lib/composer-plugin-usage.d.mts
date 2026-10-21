import type { GoogleStatus } from "./google-client";
import type { GitHubManagement } from "./github.functions";

export type ComposerSavedConversation = {
  readonly temporary?: boolean;
  readonly messages: readonly {
    readonly id: string;
    readonly role: string;
    readonly activities?: readonly { readonly tool: string; readonly status: string }[];
  }[];
};
export type ComposerConnectionSnapshot = {
  principal: string;
  google?: GoogleStatus;
  github?: GitHubManagement;
  githubAccess?: "none" | "view" | "write";
  loading: boolean;
};
export const READ_ONLY_PLUGIN_TOOLS: Readonly<Record<string, string>>;
export function rankConnectedComposerPlugins(
  conversations: readonly ComposerSavedConversation[],
  connectedIds: readonly string[],
): { id: string; count: number }[];
export function composerPluginConnection(
  id: string,
  context: {
    userId: string | null;
    authLoaded: boolean;
    snapshot: ComposerConnectionSnapshot | null;
  },
): { label: string; connected: boolean; action: string };
