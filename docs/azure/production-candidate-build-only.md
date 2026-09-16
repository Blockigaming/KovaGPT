# Production candidate build only

This is a preparation path, not a release or cutover. The registry image push is
an Azure write and ACR build/storage may incur cost. No build is authorized by a
successful pull-request test. Do not dispatch until the owner approves the
build/push within the existing budget and verifies the protected settings.

## Existing contracts preserved

At implementation baseline `b964d1bc9fcd81fcfc70e97a22cbf4a516605c94`, the production
PLAN workflow requires an existing digest-pinned image with matching source SHA,
Git tree, production browser configuration, and version-3 `acr-git` provenance.
The production Dockerfile already creates that provenance and runs the built
artifact removal check. Neither file is changed by this path.

Do not run, reuse, or retarget the `ca-kovagpt-dev` deployment workflow. Its browser
configuration and target are for development. Do not rerun the completed Auth
rehearsal. Do not change migration history or any of the 19 unresolved proofs.

## What runs

`.github/workflows/build-azure-production-candidate.yml` has a source-test job
without Azure credentials or a protected environment. Only an explicit
`workflow_dispatch` on `main`, with `BUILD_ONLY` and an exact matching approved SHA,
can enter its protected `production` build job.

The builder:

1. Validates the approved production target and extracts only browser-safe values
   from the same protected parameters used by PLAN. Checks the exact clean checkout
   and live Git `main` before queuing a build.
2. Verifies the registry login server and permission mode, and fails on an existing
   unique candidate tag or a tag-list authorization error.
3. Uses `az acr build` with the exact remote Git commit, the existing Dockerfile,
   Linux/AMD64, and a 1,800-second ACR timeout. Browser verification cannot be disabled.
   Build logs are not streamed. Only seven explicitly allowed build arguments are sent.
4. Gets the immutable digest from that successful build's output image, with a
   separate tag consistency check. A tag lookup is never the source of the digest.
5. Pulls by digest; verifies source/tree/project/config labels; extracts the browser
   provenance and browser files from a created but never started container; reruns
   the existing browser configuration/secret scanner against those actual files.
6. Publishes only verified key-free `candidate.json`, `image-reference.txt`, and
   `browser-config-provenance.json`. Cleans up its local verification container/files.

The output is preparation evidence, not a supply-chain signature or release
approval. It is not an assertion that this candidate is deployed, healthy against
production, migration-compatible, or the current serving image. The SHA/tree in
the artifact identify what was built, even if main advances afterward.

No Container App, deployment, traffic, database, DNS, identity/RBAC, Key Vault,
billing or model-enablement command is invoked. Existing image tags/digests are
not deleted or rewritten. Never use the `latest` tag for this candidate.

## Manual chat: exact owner action

After independent review and required checks, approve/merge the source PR through
the normal process. That is not permission to deploy. Use the resulting reviewed
current main SHA, not the implementation baseline above.

Verify these existing `production` environment settings privately:

| Variable | Required value |
| --- | --- |
| `KOVA_PRODUCTION_ACR_NAME` | `kovagptacr` |
| `KOVA_PRODUCTION_ACR_LOGIN_SERVER` | `kovagptacr-dte9hugbhjghcyb8.azurecr.io` |
| `KOVA_PRODUCTION_IMAGE_REPOSITORY` | `kovagpt-web` |
| `KOVA_PRODUCTION_SUPABASE_PROJECT_REF` | `mfbycmbjygcfkrsuepxf` |
| `KOVA_PRODUCTION_STRIPE_PUBLISHABLE_KEY` | The existing approved live publishable key, or intentionally empty as in PLAN |

`KOVA_PRODUCTION_BICEP_PARAMETERS_JSON` must contain `parameters.acrName.value`
matching the registry, `parameters.supabaseUrl.value` equal to
`https://mfbycmbjygcfkrsuepxf.supabase.co`, and the approved browser-safe
`parameters.supabasePublishableKey.value`. Do not paste keys or the parameters
secret into chat. No new browser-config secret is necessary.

The existing protected `KOVAGPTPROD_AZURE_CLIENT_ID`,
`KOVAGPTPROD_AZURE_TENANT_ID`, and `KOVAGPTPROD_AZURE_SUBSCRIPTION_ID` are used for
OIDC. An owner must verify that this identity may inspect the existing registry,
queue ACR builds, inspect tags, and pull the output image. A PLAN-only identity may
not yet have build permission. Do not grant subscription-wide Contributor or alter
roles automatically. ACR task execution and repository data access are different
permissions; use the registry's actual RBAC/ABAC mode. ABAC quick builds explicitly
use `[caller]`; unknown modes or missing permissions stop the build.

Before approving a push, verify that no external ACR webhook, task or image watcher
automatically deploys `production-candidate-*` tags. This workflow never dispatches
a deployment, but cannot disable or certify unrelated downstream automation.

In GitHub Actions, select **Build Azure production candidate only** and choose
**Run workflow** on `main`:

- `confirmation`: `BUILD_ONLY`;
- `source_sha`: the full reviewed current main SHA, matching the workflow revision.

Approve the protected environment only for this build/push and its authorized
cost. If main changed while awaiting approval, the builder stops rather than
silently building a different revision. No Azure command needs to be pasted into
Cloud Shell for this path.

After success, retain the artifact and give the Manual chat the run ID, immutable
image reference, source SHA/tree and provenance hashes. The next separate action
is **Validate KovaGPT Azure production plan**, with `confirmation=PLAN` and
`image_reference` copied verbatim from `image-reference.txt`. That workflow must
select the same main SHA. If main advanced, rebuild the new reviewed SHA; do not
relabel the old image or weaken PLAN. Do not proceed to deployment or cutover.

## Verification and limitations

Run `node --test tests/unit/azure-production-candidate-build.test.mjs` for pure
input/digest checks, a command-mocked build/inspection flow, real synthetic-browser
scanner checks and negative controls. No tests queue an ACR build or connect to a
production database. Source CI also checks the four changed files using the
repository-locked formatter; formatting the disposable runner checkout does not
commit or publish a repair.

A real protected build, ACR authorization check, actual Docker build/pull and
production-config verification remain owner-run evidence. Existing full-repository
CI, independent review, database compatibility, staged runtime tests and rollback
are separate requirements; this path neither bypasses nor satisfies them.

## External command references

- [Azure CLI ACR build](https://learn.microsoft.com/en-us/cli/azure/acr#az-acr-build)
- [ACR built-in roles](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-rbac-built-in-roles-directory-reference)
- [ACR ABAC effects on quick builds](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-rbac-abac-repository-permissions)
