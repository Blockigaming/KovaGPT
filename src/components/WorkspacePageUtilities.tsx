import { createContext, type ReactNode } from "react";

// AppShell owns the utility instance; pages opt into the shared header slot.
export const WorkspacePageUtilities = createContext<ReactNode>(null);
