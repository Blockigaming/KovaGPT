/**
 * Only a confirmed missing record or an explicitly incomplete record starts setup.
 * Missing/malformed server-function results are not evidence of a new account.
 */
export function shouldOpenOnboarding(record) {
  if (record === null) return true;
  return (
    typeof record === "object" &&
    !Array.isArray(record) &&
    Object.hasOwn(record, "completed") &&
    record.completed === false &&
    !Object.hasOwn(record, "error")
  );
}
