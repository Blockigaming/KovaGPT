import type { AuthedCaller } from "./api-auth.server";
export function makeAccountLifecycleHandlers(options: {
  authenticate: (request: Request) => Promise<AuthedCaller | Response>;
}): {
  GET: (context: { request: Request }) => Promise<Response>;
  DELETE: (context: { request: Request }) => Promise<Response>;
  PATCH: (context: { request: Request }) => Promise<Response>;
};
