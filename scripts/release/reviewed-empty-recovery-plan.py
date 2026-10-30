#!/usr/bin/env python3
"""Validate an owner's explicit reviewed plan; never infer review from a probe.

This is a pure validation component. It does not fetch artifacts, create a
container, read a phrase, decrypt data, write SQL or manufacture target evidence.
The execution coordinator must supply fresh actually observed proofs separately.
"""
from datetime import datetime, timezone
import hashlib
import json
import re

PROJECT = "mfbycmbjygcfkrsuepxf"
SERVER_IMAGE = "public.ecr.aws/supabase/postgres@sha256:3e2a7ab48783077d0122dc72ed5174afb543110c38266c845716c51d130658e4"
BUILD = "17.6.1.155"
SCOPE = "FRESH_DISTINCT_TARGET_IDS_FROM_REVIEWED_RECIPE"
SHA = re.compile(r"[a-f0-9]{64}\Z")
SOURCE = re.compile(r"[a-f0-9]{40}\Z")
PIN_KEYS = frozenset({"emptyBaselineCensusSha256", "emptyBaselineCatalogSha256",
                      "emptyBaselineRowsSha256", "emptyBaselineSchemaSha256"})
RECIPE_FILES = frozenset({
    "managed-auth-recovery.py", "managed-auth-recovery-target.mjs", "verify-isolated-restore-target.mjs",
    "empty-restore-target-catalog.sql", "probe-empty-recovery-target.py", "run-isolated-recovery-client.py",
    "run-reviewed-empty-recovery.py", "reviewed-empty-recovery-plan.py", "operator-recovery-probe.py",
    "prepare-recovery-operator-image.py", "recovery-operator-client-smoke.py", "recovery-operator-client.Dockerfile",
    "collect-empty-recovery-metadata.py", "extension-member-semantics-preflight.sql",
    "extension-semantic-capture.py", "extension-routine-type-payloads.py", "extension-routine-type-hash-query.py",
    "extension-relation-payloads.py", "extension-relation-query-hooks.py", "pg17-extension-relation-manifest.json",
    "canonicalize-pg17-extension-nodes.py", "pg17-extension-node-schema.json",
    "extension-regclass-datum-byteorder-audit.sql",
})


class Stopped(Exception):pass


def require(ok, code):
    if not ok:raise Stopped(code)


def canonical(value):return (json.dumps(value,sort_keys=True,separators=(",",":"))+"\n").encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()


def timestamp(value):
    require(isinstance(value,str),"review_time_unqualified")
    try:result=datetime.fromisoformat(value.replace("Z","+00:00"))
    except (TypeError,ValueError):raise Stopped("review_time_unqualified") from None
    require(result.tzinfo is not None and result.utcoffset().total_seconds()==0,"review_time_unqualified")
    return result.timestamp()


def exact_hash(value):
    return isinstance(value,str) and SHA.fullmatch(value) is not None


def artifact_pin(value, *, oci=False):
    require(isinstance(value,dict) and type(value.get("runId")) is int and value["runId"]>0
            and type(value.get("artifactId")) is int and value["artifactId"]>0
            and SOURCE.fullmatch(value.get("sourceSha",""))
            and exact_hash(value.get("receiptSha256")),"artifact_review_pin_unqualified")
    if oci:
        require(re.fullmatch(r"sha256:[a-f0-9]{64}",value.get("imageId",""))
                and exact_hash(value.get("inventorySha256")) and exact_hash(value.get("archiveSha256"))
                and type(value.get("archiveBytes")) is int and 0<value["archiveBytes"]<=4*1024**3,
                "operator_artifact_review_unqualified")
    return value


_REVIEW_STAMP=object()


class ReviewedPlan:
    """An in-process validation result; raw input JSON cannot grant this type."""
    def __init__(self,value,sha256,stamp):
        require(stamp is _REVIEW_STAMP,"validated_owner_plan_required")
        self._bytes=canonical(value);self.sha256=sha256;self._stamp=stamp
    def value(self):return json.loads(self._bytes)


def validated_plan(raw, expected_sha256, context, receipts, recipe_hashes, *, now=None):
    now=datetime.now(timezone.utc).timestamp() if now is None else now
    require(exact_hash(expected_sha256) and sha(raw)==expected_sha256,"reviewed_plan_hash_mismatch")
    def no_duplicates(pairs):
        out={}
        for key,value in pairs:
            require(key not in out,"reviewed_plan_duplicate_key");out[key]=value
        return out
    require(len(raw)<=64*1024,"reviewed_plan_bound")
    p=json.loads(raw,object_pairs_hook=no_duplicates)
    actor=context.get("GITHUB_ACTOR","");owner=context.get("GITHUB_REPOSITORY_OWNER","")
    require(context.get("GITHUB_ACTIONS")=="true" and context.get("RUNNER_OS")=="Linux"
            and context.get("GITHUB_EVENT_NAME")=="workflow_dispatch"
            and context.get("GITHUB_REPOSITORY")=="Blockigaming/KovaGPT"
            and context.get("GITHUB_REF")=="refs/heads/main" and actor and owner
            and actor.casefold()==owner.casefold()=="blockigaming","owner_main_manual_dispatch_required")
    require(isinstance(p,dict) and p.get("format")==1 and p.get("ownerReviewed") is True
            and p.get("reviewScope")==SCOPE and p.get("freshDistinctTargetIdsAllowed") is True
            and p.get("priorTargetsReused") is False and p.get("reviewedBy","").casefold()==actor.casefold(),
            "explicit_owner_review_missing")
    reviewed,expires=timestamp(p.get("reviewedAt")),timestamp(p.get("expiresAt"))
    require(-5<=now-reviewed<=86400 and reviewed<expires<=reviewed+86400 and now<=expires,
            "owner_review_stale")
    require(p.get("sourceProject")==PROJECT and p.get("destinationKind")=="fresh-private-template0-docker-tmpfs"
            and p.get("sourceSha")==context.get("GITHUB_SHA")==context.get("KOVA_APPROVED_SOURCE_SHA")
            and SOURCE.fullmatch(p.get("sourceSha","")) and p.get("postgresBuild")==BUILD
            and p.get("serverImageRepoDigest")==SERVER_IMAGE
            and p.get("approvedTargetOnlyRoles")==["kova_probe_operator"],"reviewed_source_or_target_recipe_mismatch")
    require(set(recipe_hashes)==RECIPE_FILES and p.get("recipeFileSha256")==recipe_hashes
            and all(exact_hash(v) for v in recipe_hashes.values()),"reviewed_recipe_hash_mismatch")
    pins=p.get("reviewedBaselineFingerprints",{})
    require(set(pins)==PIN_KEYS and all(exact_hash(v) for v in pins.values()),"reviewed_baseline_pin_missing")
    prior=artifact_pin(p.get("nativeProbe"));operator=artifact_pin(p.get("operatorClient"),oci=True)
    capture=artifact_pin(p.get("capture"))
    require(exact_hash(capture.get("ciphertextSha256")) and type(capture.get("ciphertextBytes")) is int
            and 0<capture["ciphertextBytes"]<=4*1024**3,"capture_review_pin_unqualified")
    for key,pin in [("nativeProbe",prior),("operatorClient",operator),("capture",capture)]:
        envelope=receipts.get(key,{})
        require(envelope.get("runId")==pin["runId"] and envelope.get("artifactId")==pin["artifactId"]
                and envelope.get("sourceSha")==pin["sourceSha"] and envelope.get("receiptSha256")==pin["receiptSha256"]
                and envelope.get("repository")=="Blockigaming/KovaGPT" and envelope.get("githubIdentityVerified") is True,
                "reviewed_artifact_identity_mismatch")
    proof=receipts["nativeProbe"]["receipt"]
    require(proof.get("operation")=="data-free-native-empty-target-probe"
            and proof.get("dataFreeSafetyProofComplete") is True and proof.get("sourceMetadataCompatible") is True
            and proof.get("cleanupConfirmed") is True and proof.get("observedBaselineFingerprints")==pins
            and proof.get("imageRepoDigest")==SERVER_IMAGE and proof.get("nativeServerVersionNum")==170006
            and proof.get("customerRowsUsed") is False and proof.get("customerRestorePerformed") is False
            and proof.get("targetsRetained") is False,"prior_actual_native_proof_unqualified")
    image=receipts["operatorClient"]["receipt"]
    require(image.get("operation")=="data-free-recovery-operator-image-preparation"
            and image.get("clientImageId")==operator["imageId"] and image.get("inventorySha256")==operator["inventorySha256"]
            and image.get("ociArchiveSha256")==operator["archiveSha256"] and image.get("ociArchiveBytes")==operator["archiveBytes"]
            and image.get("nativeToolSmokePassed") is True and image.get("customerDataReceived") is False
            and image.get("restorePerformed") is False,"actual_operator_image_proof_unqualified")
    backup=receipts["capture"]["receipt"]
    require(backup.get("operation")=="managed-auth-capture" and backup.get("sourceSha")==capture["sourceSha"]
            and backup.get("encryptedSha256")==capture["ciphertextSha256"] and backup.get("encryptedBytes")==capture["ciphertextBytes"]
            and all(backup.get(k) is True for k in ["completeRequiredDatabaseTableCoverage","consistentSnapshot","encryptedRoundtripVerified"])
            and backup.get("plaintextUploaded") is False and backup.get("productionMutated") is False,
            "actual_capture_proof_unqualified")
    # Capture must contain complete same-snapshot canonical source metadata.
    # The independently isolated recipient can decrypt it for comparison;
    # semantic equality is then mandatory BEFORE customer-data import. A hash
    # inventory alone cannot substitute for this actual capture completeness.
    require(exact_hash(p.get("sourceCanonicalSemanticsSha256"))
            and backup.get("extensionSemanticCanonicalSha256")==p["sourceCanonicalSemanticsSha256"]
            and backup.get("extensionSemanticCaptureSameExportedSnapshot") is True
            and backup.get("extensionSemanticCoverageComplete") is True
            and p.get("allowDecryptionForSemanticComparison") is True
            and p.get("customerImportRequiresSemanticEquality") is True,
            "source_extension_semantic_capture_unqualified")
    resources=p.get("resources")
    require(type(resources) is dict and set(resources)=={"clientMemoryMiB","clientTmpfsMiB","serverMemoryMiB","serverTmpfsMiB"}
            and all(type(resources[k]) is int and 64<=resources[k]<=32768 for k in ["clientMemoryMiB","clientTmpfsMiB"])
            and all(type(resources[k]) is dict and set(resources[k])=={"a","b"}
                    and all(type(v) is int and 64<=v<=32768 for v in resources[k].values())
                    for k in ["serverMemoryMiB","serverTmpfsMiB"])
            and resources["clientTmpfsMiB"]+128<resources["clientMemoryMiB"]
            and all(resources["serverTmpfsMiB"][k]+128<resources["serverMemoryMiB"][k] for k in ["a","b"]),
            "reviewed_memory_policy_unqualified")
    require(p.get("noPlaintextHostBacking") is True and p.get("runtimeDownloadsAllowed") is False
            and p.get("privateTmpfsNoswapRequired") is True and p.get("containerSwapDisabledRequired") is True,
            "plaintext_custody_policy_unqualified")
    return ReviewedPlan(p,expected_sha256,_REVIEW_STAMP)


def bound_fresh_attestation(reviewed, actual, *, now=None):
    """Bind actual evidence only after validated_plan and exact native checks.

    The coordinator must revalidate the plan before calling. No observations can
    substitute for its explicit independently reviewed fresh-ID approval scope.
    This function never refreshes an observation timestamp.
    """
    now=datetime.now(timezone.utc).timestamp() if now is None else now
    require(type(reviewed) is ReviewedPlan and reviewed._stamp is _REVIEW_STAMP
            and exact_hash(reviewed.sha256),"validated_owner_plan_required")
    plan=reviewed.value();plan_sha256=reviewed.sha256
    require(plan.get("ownerReviewed") is True and plan.get("reviewScope")==SCOPE
            and plan.get("freshDistinctTargetIdsAllowed") is True,"validated_owner_plan_required")
    observed=timestamp(actual.get("observedAt"))
    require(-5<=now-observed<=60 and now<=timestamp(plan["expiresAt"]),"fresh_native_evidence_stale")
    require(actual.get("baselineFingerprints")==plan["reviewedBaselineFingerprints"]
            and actual.get("clientImageId")==plan["operatorClient"]["imageId"]
            and actual.get("clientInventorySha256")==plan["operatorClient"]["inventorySha256"]
            and actual.get("serverImageRepoDigest")==plan["serverImageRepoDigest"]
            and exact_hash(actual.get("networkEvidenceSha256"))
            and all(actual.get(k) is True for k in ["freshDistinctIdsCreated","originalDestinationGuardPassed",
               "privateTlsIpv4Passed","privateTlsIpv6Passed","wrongCaRejected","wrongHostnameRejected",
               "productionRoutesDenied","internetEgressDenied","consumersStopped","allRowsEmpty",
               "privateTmpfsNoswapObserved","containerSwapDisabledObserved"])
            and actual.get("cronLaunchActiveJobs") is False,"fresh_native_target_unqualified")
    target=actual.get("target",{})
    require(set(target)=={"host","database","port","serverIp","systemIdentifier"}
            and target["database"]=="postgres" and target["port"]==5432
            and re.fullmatch(r"[0-9]+",target.get("systemIdentifier","")),"fresh_target_identity_missing")
    # Original JS configuration/SQL guards still verify host, IP, TLS and systemID.
    return {"format":1,"sourceProject":PROJECT,"imageTag":"public.ecr.aws/supabase/postgres:"+BUILD,
            "actualImageRepoDigest":plan["serverImageRepoDigest"],"postgresBuild":BUILD,
            **target,"observedAt":actual["observedAt"],"networkEvidenceSha256":actual["networkEvidenceSha256"],
            "productionRoutesDenied":True,"internetEgressDenied":True,"consumersStopped":True,
            "cronLaunchActiveJobs":False,"independentlyReviewed":True,"ownerReviewedPlanSha256":plan_sha256,
            "customerImportRequiresSemanticEquality":True,
            "sourceCanonicalSemanticsSha256":plan["sourceCanonicalSemanticsSha256"],
            "baselineMode":"empty-database","emptyBaselineIndependentlyReviewed":True,
            "emptyBaselineSource":"pinned-image-template0-plus-extensions",
            "approvedTargetOnlyRoles":plan["approvedTargetOnlyRoles"],**plan["reviewedBaselineFingerprints"]}
