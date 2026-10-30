"""Synthetic review/provenance gates; no artifact fetch, Docker, SQL or secrets."""
import copy
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import unittest

SCRIPT=Path(__file__).resolve().parents[2]/"scripts/release/reviewed-empty-recovery-plan.py"
spec=importlib.util.spec_from_file_location("reviewed_plan",SCRIPT)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
NOW=1800000000

def stamp(seconds):return datetime.fromtimestamp(seconds,timezone.utc).isoformat()


def fixture():
    recipes={name:"a"*64 for name in m.RECIPE_FILES}
    pin={"runId":12,"artifactId":34,"sourceSha":"b"*40,"receiptSha256":"c"*64}
    operator={**pin,"imageId":"sha256:"+"d"*64,"inventorySha256":"e"*64,"archiveSha256":"f"*64,"archiveBytes":1234}
    capture={**pin,"ciphertextSha256":"f"*64,"ciphertextBytes":456}
    baseline={name:"1"*64 for name in m.PIN_KEYS}
    plan={"format":1,"ownerReviewed":True,"reviewScope":m.SCOPE,"freshDistinctTargetIdsAllowed":True,
          "priorTargetsReused":False,"reviewedBy":"Blockigaming","reviewedAt":stamp(NOW-5),"expiresAt":stamp(NOW+600),
          "sourceProject":m.PROJECT,"destinationKind":"fresh-private-template0-docker-tmpfs","sourceSha":"b"*40,
          "postgresBuild":m.BUILD,"serverImageRepoDigest":m.SERVER_IMAGE,"approvedTargetOnlyRoles":["kova_probe_operator"],
          "recipeFileSha256":recipes,"reviewedBaselineFingerprints":baseline,"nativeProbe":pin,"operatorClient":operator,
          "capture":capture,"sourceCanonicalSemanticsSha256":"2"*64,
          "allowDecryptionForSemanticComparison":True,"customerImportRequiresSemanticEquality":True,
          "resources":{"clientMemoryMiB":768,"clientTmpfsMiB":128,
              "serverMemoryMiB":{"a":768,"b":768},"serverTmpfsMiB":{"a":256,"b":256}},
          "noPlaintextHostBacking":True,
          "runtimeDownloadsAllowed":False,"privateTmpfsNoswapRequired":True,"containerSwapDisabledRequired":True}
    context={"GITHUB_ACTIONS":"true","RUNNER_OS":"Linux","GITHUB_EVENT_NAME":"workflow_dispatch",
             "GITHUB_REPOSITORY":"Blockigaming/KovaGPT","GITHUB_REF":"refs/heads/main","GITHUB_ACTOR":"Blockigaming",
             "GITHUB_REPOSITORY_OWNER":"Blockigaming","GITHUB_SHA":"b"*40,"KOVA_APPROVED_SOURCE_SHA":"b"*40}
    envelope={"runId":12,"artifactId":34,"sourceSha":"b"*40,"receiptSha256":"c"*64,
              "repository":"Blockigaming/KovaGPT","githubIdentityVerified":True}
    receipts={"nativeProbe":{**envelope,"receipt":{"operation":"data-free-native-empty-target-probe",
      "dataFreeSafetyProofComplete":True,"sourceMetadataCompatible":True,"cleanupConfirmed":True,
      "observedBaselineFingerprints":baseline,"imageRepoDigest":m.SERVER_IMAGE,"nativeServerVersionNum":170006,
      "customerRowsUsed":False,"customerRestorePerformed":False,"targetsRetained":False}},
      "operatorClient":{**envelope,"receipt":{"operation":"data-free-recovery-operator-image-preparation",
       "clientImageId":operator["imageId"],"inventorySha256":operator["inventorySha256"],
       "ociArchiveSha256":operator["archiveSha256"],"ociArchiveBytes":operator["archiveBytes"],
       "nativeToolSmokePassed":True,"customerDataReceived":False,"restorePerformed":False}},
      "capture":{**envelope,"receipt":{"operation":"managed-auth-capture","sourceSha":"b"*40,
       "encryptedSha256":capture["ciphertextSha256"],"encryptedBytes":capture["ciphertextBytes"],
       "completeRequiredDatabaseTableCoverage":True,"consistentSnapshot":True,"encryptedRoundtripVerified":True,
       "plaintextUploaded":False,"productionMutated":False,
       "extensionSemanticCanonicalSha256":"2"*64,"extensionSemanticCaptureSameExportedSnapshot":True,
       "extensionSemanticCoverageComplete":True}},
      "extensionSemantics":{"receiptSha256":"2"*64,"actualPg17SourceAndImageCompared":True,
       "allCatalogFieldsCovered":True,"semanticEqualityProven":True,"unsupportedPayloadCount":0}}
    actual={"observedAt":stamp(NOW-2),"baselineFingerprints":baseline,"clientImageId":operator["imageId"],
       "clientInventorySha256":operator["inventorySha256"],"serverImageRepoDigest":m.SERVER_IMAGE,
       "networkEvidenceSha256":"3"*64,"cronLaunchActiveJobs":False,
       **{k:True for k in ["freshDistinctIdsCreated","originalDestinationGuardPassed","privateTlsIpv4Passed",
         "privateTlsIpv6Passed","wrongCaRejected","wrongHostnameRejected","productionRoutesDenied",
         "internetEgressDenied","consumersStopped","allRowsEmpty","privateTmpfsNoswapObserved",
         "containerSwapDisabledObserved","extensionSemanticsEqual"]},
       "target":{"host":"synthetic-target.internal","database":"postgres","port":5432,
                 "serverIp":"172.30.240.2","systemIdentifier":"123456789"}}
    return tuple(copy.deepcopy(x) for x in [plan,context,receipts,recipes,actual])


class PlanTests(unittest.TestCase):
    def validate(self,f):
        p,c,r,h,_=f;raw=json.dumps(p,indent=2).encode()
        return m.validated_plan(raw,m.sha(raw),c,r,h,now=NOW)

    def test_explicit_review_authorizes_fresh_proven_ids_without_reusing_prior_targets(self):
        f=fixture();reviewed=self.validate(f)
        proof=m.bound_fresh_attestation(reviewed,f[4],now=NOW)
        self.assertTrue(proof["independentlyReviewed"])
        self.assertEqual(proof["systemIdentifier"],"123456789")
        self.assertEqual(proof["observedAt"],stamp(NOW-2))
        self.assertEqual(proof["ownerReviewedPlanSha256"],reviewed.sha256)
        self.assertEqual(proof["emptyBaselineSource"],"pinned-image-template0-plus-extensions")
        self.assertTrue(proof["customerImportRequiresSemanticEquality"])
        self.assertEqual(proof["sourceCanonicalSemanticsSha256"],"2"*64)

    def test_missing_or_unreviewed_or_wrong_scope_never_grants_review(self):
        for key,value in [("ownerReviewed",False),("reviewScope","auto-observed"),
                          ("freshDistinctTargetIdsAllowed",False),("priorTargetsReused",True)]:
            f=fixture();f[0][key]=value
            with self.subTest(key=key),self.assertRaises(m.Stopped):self.validate(f)
        f=fixture()
        with self.assertRaises(m.Stopped):m.bound_fresh_attestation(f[0],f[4],now=NOW)
        with self.assertRaises(m.Stopped):m.ReviewedPlan(f[0],"0"*64,object())

    def test_stale_review_wrong_source_actor_event_or_recipe_is_rejected(self):
        for which,key,value in [(0,"reviewedAt",stamp(NOW-90000)),(0,"expiresAt",stamp(NOW-1)),
              (0,"sourceSha","f"*40),(1,"GITHUB_ACTOR","another-user"),(1,"GITHUB_EVENT_NAME","pull_request"),
              (1,"GITHUB_REF","refs/heads/other"),(1,"GITHUB_REPOSITORY","other/repo")]:
            f=fixture();f[which][key]=value
            with self.subTest(key=key),self.assertRaises(m.Stopped):self.validate(f)
        f=fixture();f[3][next(iter(m.RECIPE_FILES))]="f"*64
        with self.assertRaises(m.Stopped):self.validate(f)

    def test_forged_artifact_identity_image_inventory_or_ciphertext_is_rejected(self):
        for section,key,value in [("nativeProbe","githubIdentityVerified",False),("operatorClient","artifactId",999),
                                 ("capture","sourceSha","a"*40)]:
            f=fixture();f[2][section][key]=value
            with self.subTest(section=section,key=key),self.assertRaises(m.Stopped):self.validate(f)
        for section,key,value in [("operatorClient","clientImageId","sha256:"+"0"*64),
              ("operatorClient","inventorySha256","0"*64),("capture","encryptedSha256","0"*64),
              ("capture","encryptedRoundtripVerified",False),("nativeProbe","cleanupConfirmed",False)]:
            f=fixture();f[2][section]["receipt"][key]=value
            with self.subTest(section=section,key=key),self.assertRaises(m.Stopped):self.validate(f)

    def test_inventory_or_raw_opaque_hashes_cannot_substitute_for_capture_semantics(self):
        for key,value in [("extensionSemanticCanonicalSha256","0"*64),
                          ("extensionSemanticCaptureSameExportedSnapshot",False),
                          ("extensionSemanticCoverageComplete",False)]:
            f=fixture();f[2]["capture"]["receipt"][key]=value
            with self.subTest(key=key),self.assertRaises(m.Stopped):self.validate(f)
        f=fixture();f[0]["customerImportRequiresSemanticEquality"]=False
        with self.assertRaises(m.Stopped):self.validate(f)
        f=fixture();f[0]["allowDecryptionForSemanticComparison"]=False
        with self.assertRaises(m.Stopped):self.validate(f)

    def test_fresh_actual_proofs_must_match_every_pin_and_cannot_refresh_timestamps(self):
        for key,value in [("observedAt",stamp(NOW-61)),("privateTlsIpv6Passed",False),
              ("wrongCaRejected",False),("internetEgressDenied",False),("consumersStopped",False),
              ("privateTmpfsNoswapObserved",False),
              ("clientImageId","sha256:"+"0"*64),("clientInventorySha256","0"*64),
              ("baselineFingerprints",{k:"0"*64 for k in m.PIN_KEYS}),("cronLaunchActiveJobs",True)]:
            f=fixture();reviewed=self.validate(f);f[4][key]=value
            with self.subTest(key=key),self.assertRaises(m.Stopped):m.bound_fresh_attestation(reviewed,f[4],now=NOW)

    def test_validated_plan_is_immutable_and_cannot_be_edited_after_review(self):
        f=fixture();reviewed=self.validate(f)
        exposed=reviewed.value();exposed["ownerReviewed"]=False
        f[0]["reviewedBaselineFingerprints"][next(iter(m.PIN_KEYS))]="0"*64
        self.assertTrue(reviewed.value()["ownerReviewed"])
        proof=m.bound_fresh_attestation(reviewed,f[4],now=NOW)
        self.assertTrue(proof["independentlyReviewed"])

    def test_raw_review_hash_duplicate_keys_and_plaintext_custody_changes_are_rejected(self):
        f=fixture();raw=m.canonical(f[0])
        with self.assertRaises(m.Stopped):m.validated_plan(raw,"0"*64,f[1],f[2],f[3],now=NOW)
        duplicate=b'{"ownerReviewed":true,"ownerReviewed":false}'
        with self.assertRaises(m.Stopped):m.validated_plan(duplicate,m.sha(duplicate),f[1],f[2],f[3],now=NOW)
        f[0]["runtimeDownloadsAllowed"]=True
        with self.assertRaises(m.Stopped):self.validate(f)


if __name__=="__main__":unittest.main()
