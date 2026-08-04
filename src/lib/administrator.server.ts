import { requireUser, type AuthedCaller } from "@/lib/api-auth.server";

const ID = /^[a-zA-Z0-9_-]{3,128}$/;
export type AdminAuthorization = { caller: AuthedCaller } | { response: Response };

export function configuredAdministratorIds(): ReadonlySet<string> {
  return new Set(
    (process.env.KOVA_ADMIN_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => ID.test(value))
      .slice(0, 25),
  );
}

export async function requireAdministrator(
  request: Request,
  correlationId = request.headers.get("x-correlation-id")?.match(/^[a-zA-Z0-9-]{8,64}$/)?.[0] ??
    crypto.randomUUID(),
): Promise<AdminAuthorization> {
  const caller = await requireUser(request);
  if (caller instanceof Response) return { response: caller };
  const admins = configuredAdministratorIds();
  if (!admins.size)
    return {
      response: Response.json(
        { error: "diagnostics_unavailable", correlationId },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      ),
    };
  if (!admins.has(caller.userId))
    return {
      response: Response.json(
        { error: "forbidden", correlationId },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      ),
    };
  return { caller };
}
