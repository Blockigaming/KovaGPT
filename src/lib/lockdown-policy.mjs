export const LOCKDOWN_CAPABILITIES = Object.freeze([
  "live_web",
  "deep_research",
  "agent",
  "connector_read",
  "connector_write",
  "canvas_network",
  "remote_download",
]);

const CAPABILITIES = new Set(LOCKDOWN_CAPABILITIES);

export class LockdownPolicyError extends Error {
  constructor(code, status, cause) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = "LockdownPolicyError";
    this.code = code;
    this.status = status;
  }
}

function fail(code, status, cause) {
  throw new LockdownPolicyError(code, status, cause);
}

export function lockdownEnabledFromSettings(settings) {
  if (settings === null || settings === undefined) return false;
  if (typeof settings !== "object" || Array.isArray(settings)) {
    fail("lockdown_settings_invalid", 503);
  }
  return settings.lockdown_mode === true;
}

export async function readLockdownMode(client, userId) {
  if (
    typeof userId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(userId)
  ) {
    fail("lockdown_principal_invalid", 401);
  }

  let result;
  try {
    result = await client
      .from("user_preferences")
      .select("settings")
      .eq("user_id", userId)
      .maybeSingle();
  } catch (error) {
    fail("lockdown_state_unavailable", 503, error);
  }
  if (result?.error) fail("lockdown_state_unavailable", 503, result.error);
  return lockdownEnabledFromSettings(result?.data?.settings);
}

export async function assertLockdownAllows(client, userId, capability) {
  if (!CAPABILITIES.has(capability)) fail("lockdown_capability_invalid", 500);
  if (await readLockdownMode(client, userId)) {
    fail(`lockdown_blocked_${capability}`, 403);
  }
}

export function lockdownErrorResponse(error) {
  if (!(error instanceof LockdownPolicyError)) return null;
  const unavailable = error.status === 503;
  return Response.json(
    {
      error: unavailable
        ? "Lockdown Mode could not be verified. Try again shortly."
        : "This network-enabled capability is unavailable while Lockdown Mode is on.",
      code: error.code,
    },
    {
      status: error.status,
      headers: {
        "Cache-Control": "no-store",
        ...(unavailable ? { "Retry-After": "5" } : {}),
      },
    },
  );
}

export async function enforceLockdownCapability(client, userId, capability) {
  try {
    await assertLockdownAllows(client, userId, capability);
    return null;
  } catch (error) {
    const response = lockdownErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
