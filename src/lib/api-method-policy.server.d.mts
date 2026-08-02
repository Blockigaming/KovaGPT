export type ApiMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

export type ApiMethodPolicyRoute = Readonly<{
  path: string;
  methods: readonly ApiMethod[];
}>;

export const API_METHOD_POLICY_ROUTES: readonly ApiMethodPolicyRoute[];

export function getDeclaredApiMethodsForPath(pathname: string): readonly ApiMethod[] | null;

export function rejectUnsupportedApiMethod(request: Request): Response | null;
