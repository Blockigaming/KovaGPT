import { readAccountIdentity } from "../account-identity.server.mjs";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const EMAIL = /^[^\s@]+@[^\s@]+$/u;

/** A separately enabled operator exception for bounded OpenAI tasks, not a paid plan. */
export async function hasOpenAiOperatorAccess(caller, env, lookup = readAccountIdentity) {
  const accountId = env("KOVA_OPENAI_OPERATOR_ACCOUNT_ID");
  const email = env("KOVA_OPENAI_OPERATOR_EMAIL");
  if (
    env("KOVA_OPENAI_OPERATOR_ACCESS_ENABLED") !== "true" ||
    !UUID.test(accountId ?? "") ||
    typeof email !== "string" ||
    email !== email.trim() ||
    !EMAIL.test(email) ||
    caller?.userId !== accountId
  )
    return false;
  try {
    const identity = await lookup(caller.supabaseAdmin, accountId);
    return (
      identity?.id === accountId &&
      identity.email.toLowerCase() === email.toLowerCase() &&
      typeof identity.email_confirmed_at === "string" &&
      Number.isFinite(Date.parse(identity.email_confirmed_at))
    );
  } catch {
    return false;
  }
}
