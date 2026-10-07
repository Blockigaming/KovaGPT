import {
  PRIVATE_PROJECT_COLUMNS,
  ownedPrivateFileLink,
} from "../../src/lib/kova-auth-private-download.mjs";

// Keep the original assertion authoritative. These bounded, read-only probes
// distinguish the opaque proxy denial without retaining bodies or credentials.
export async function captureStorageProxyFailure(run, response, fixture, row, jwt, link) {
  const originalStatus = run.lastHttpStatus;
  const diagnostics = {
    storagePrivateDenial: Number(response.data?.error === "Private file unavailable."),
    storageJsonResponse: Number(
      /application\/json/i.test(response.headers?.get("content-type") ?? ""),
    ),
    storageNoStore: Number(/no-store/i.test(response.headers?.get("cache-control") ?? "")),
    storageDiagnosticErrors: 0,
  };
  try {
    const query = new URLSearchParams({ select: PRIVATE_PROJECT_COLUMNS, id: `eq.${row.id}` });
    const fence = new URLSearchParams({
      select: "user_id",
      user_id: `eq.${fixture.principal.accountId}`,
    });
    const results = await Promise.allSettled([
      run.app("/api/auth/session", { cookie: fixture.cookie }),
      run.service(`/rest/v1/account_deletion_fences?${fence}`),
      run.bearer(`/rest/v1/project_files?${query}`, jwt),
    ]);
    for (const [index, result] of results.entries()) {
      if (result.status !== "fulfilled") {
        diagnostics.storageDiagnosticErrors++;
        continue;
      }
      const value = result.value;
      if (index === 0) {
        diagnostics.storageSessionStatus = value.status;
        diagnostics.storageSessionSame = Number(
          value.data?.session?.accountId === fixture.principal.accountId &&
            value.data?.session?.sessionId === fixture.principal.sessionId &&
            value.data?.session?.emailVerified === true,
        );
      } else if (index === 1) {
        diagnostics.storageFenceStatus = value.status;
        if (Array.isArray(value.data)) diagnostics.storageFenceRows = value.data.length;
      } else {
        diagnostics.storageMetadataStatus = value.status;
        diagnostics.storageMetadataPermissionDenied = Number(value.data?.code === "42501");
        diagnostics.storageMetadataSchemaMissing = Number(value.data?.code === "PGRST205");
        if (Array.isArray(value.data)) {
          diagnostics.storageMetadataRows = value.data.length;
          if (value.data.length === 1) {
            try {
              diagnostics.storageVersionMatch = Number(
                (await ownedPrivateFileLink(
                  "project",
                  fixture.principal.accountId,
                  value.data[0],
                )) === link,
              );
            } catch {
              diagnostics.storageMetadataInvalid = 1;
            }
          }
        }
      }
    }
  } catch {
    diagnostics.storageDiagnosticErrors++;
  } finally {
    // A later diagnostic request must not replace the failing proxy's status.
    run.lastHttpStatus = originalStatus;
    run.failureDiagnostics = diagnostics;
  }
}
