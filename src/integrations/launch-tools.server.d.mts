import type { LaunchRuntime } from "./launch-runtime.server.mjs";
export function createLaunchToolContext(input: {
  ownerId: string;
  sessionId: string;
  accounts: Record<string, unknown>[];
  runtime: LaunchRuntime;
  certified?: readonly string[];
}): {
  tools: {
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }[];
  labels: Record<string, string>;
  hasTool(name: string): boolean;
  execute(name: string, input: unknown): ReturnType<LaunchRuntime["execute"]>;
};
