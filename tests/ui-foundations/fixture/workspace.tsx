import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { ChatWorkspaceFixture } from "./chat-workspace";
import "./styles.css";
const root = createRootRoute();
const router = createRouter({
  routeTree: root.addChildren([
    createRoute({ getParentRoute: () => root, path: "/", component: ChatWorkspaceFixture }),
  ]),
  history: createMemoryHistory({ initialEntries: ["/"] }),
});
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
