import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { CommandPalette } from "@/components/CommandPalette";
import { Button } from "@/components/ui/button";
import "./styles.css";

function Fixture() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState("No action taken");
  return (
    <main className="fixture-page">
      <Button data-testid="trigger" onClick={() => setOpen(true)}>
        Search workspace
      </Button>
      <p data-testid="result">{result}</p>
      <CommandPalette
        open={open}
        query={query}
        onQueryChange={setQuery}
        conversations={[]}
        archivedConversations={[]}
        workspaceItems={[]}
        workspaceStatus="error"
        retryWorkspaceSearch={() => setResult("Retry invoked")}
        onClose={() => setOpen(false)}
        onNewChat={() => setResult("New chat invoked")}
        onSelectChat={() => setResult("Chat invoked")}
        onSelectArchived={() => setResult("Archive invoked")}
        onOpenSettings={() => setResult("Settings invoked")}
      />
    </main>
  );
}
const rootRoute = createRootRoute();
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Fixture });
const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute]),
  history: createMemoryHistory({ initialEntries: ["/"] }),
});
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
