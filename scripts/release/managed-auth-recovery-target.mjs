// Reuse the reviewed destination/pgpass/cluster guard with a current capture,
// never the historical September catalog. Input/output stay in the operator.
import { readFileSync } from "node:fs";
import { validateTargetConfig, validateObservation } from "./verify-isolated-restore-target.mjs";

try {
  const approved = validateTargetConfig(process.env);
  if (process.argv[2] === "--configuration") {
    process.stdout.write(JSON.stringify(approved));
  } else if (process.argv[2] === "--observation") {
    const input = JSON.parse(readFileSync(0, "utf8"));
    validateObservation(input.observed, approved, input.sourceExtensions);
    process.stdout.write('{"ok":true}');
  } else {
    throw new Error("mode");
  }
} catch {
  process.stderr.write('{"error":"managed_auth_recovery_target_rejected"}\n');
  process.exitCode = 1;
}
