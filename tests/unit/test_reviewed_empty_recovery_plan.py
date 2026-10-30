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


def synthetic_transport():
    """Completed-qualifier boundary fixture only; no registry/image was read."""
    return {"operation":"verified-official-server-image-transport",
        "originalEcrReference":m.ORIGINAL_SERVER_IMAGE,"transportReference":m.SERVER_IMAGE,
        "contentDigest":m.CONTENT_DIGEST,"manifestSha256":m.CONTENT_DIGEST.removeprefix("sha256:"),
        "manifestDescriptorCount":4,"compressedLayerCount":3,"imageId":"sha256:"+"4"*64,
        "actualRepoDigest":m.SERVER_IMAGE,"buildxVersion":"github.com/docker/buildx v0.24.0 synthetic",
        "semanticConfigSha256":"5"*64,"engineVerificationContract":"docker-engine-digest-pinned-pull",
        "manualLayerHashingPerformed":False}


def fixture():
    recipes={name:"a"*64 for name in m.RECIPE_FILES}
    pin={"runId":12,"artifactId":34,"sourceSha":"b"*40,"receiptSha256":"c"*64}
    operator={**pin,"imageId":"sha256:"+"d"*64,"inventorySha256":"e"*64,"archiveSha256":"f"*64,"archiveBytes":1234}
    capture={**pin,"ciphertextSha256":"f"*64,"ciphertextBytes":456}
    baseline={name:"1"*64 for name in m.PIN_KEYS}
    transport=synthetic_transport()
    plan={"format":1,"ownerReviewed":True,"reviewScope":m.SCOPE,"freshDistinctTargetIdsAllowed":True,
          "priorTargetsReused":False,"reviewedBy":"Blockigaming","reviewedAt":stamp(NOW-5),"expiresAt":stamp(NOW+600),
          "sourceProject":m.PROJECT,"destinationKind":"fresh-private-template0-docker-tmpfs","sourceSha":"b"*40,
          "postgresBuild":m.BUILD,"serverImageRepoDigest":m.SERVER_IMAGE,"approvedTargetOnlyRoles":["kova_probe_operator"],
          "originalApprovedServerImageRepoDigest":m.ORIGINAL_SERVER_IMAGE,
          "serverImageId":transport["imageId"],"serverImageSemanticConfigSha256":transport["semanticConfigSha256"],
          "reviewedServerImageTransportSha256":m.sha(m.canonical(transport)),
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
      "customerRowsUsed":False,"customerRestorePerformed":False,"targetsRetained":False,
      "serverImageTransport":copy.deepcopy(transport)}},
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
       "serverImageTransport":copy.deepcopy(transport),
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
        self.assertEqual(proof["actualImageRepoDigest"],m.SERVER_IMAGE)
        self.assertEqual(proof["originalApprovedImageRepoDigest"],m.ORIGINAL_SERVER_IMAGE)
        self.assertEqual(proof["serverImageTransport"],f[4]["serverImageTransport"])
        self.assertEqual(proof["serverImageTransportSha256"],m.sha(m.canonical(f[4]["serverImageTransport"])))
        self.assertEqual(proof["serverImageId"],f[0]["serverImageId"])
        self.assertEqual(proof["serverImageSemanticConfigSha256"],f[0]["serverImageSemanticConfigSha256"])
        self.assertEqual(proof["imageTag"],"public.ecr.aws/supabase/postgres:"+m.BUILD)

    def test_only_existing_exact_content_pin_has_official_hub_transport(self):
        digest="sha256:3e2a7ab48783077d0122dc72ed5174afb543110c38266c845716c51d130658e4"
        self.assertEqual(m.CONTENT_DIGEST,digest)
        self.assertEqual(m.ORIGINAL_SERVER_IMAGE,"public.ecr.aws/supabase/postgres@"+digest)
        self.assertEqual(m.SERVER_IMAGE,"docker.io/supabase/postgres@"+digest)
        for key,value in [("originalApprovedServerImageRepoDigest",m.SERVER_IMAGE),
                ("originalApprovedServerImageRepoDigest","public.ecr.aws/supabase/postgres@sha256:"+"0"*64),
                ("serverImageRepoDigest",m.ORIGINAL_SERVER_IMAGE),
                ("serverImageRepoDigest","supabase/postgres@"+digest),
                ("serverImageRepoDigest","docker.io/supabase/postgres@sha256:"+"0"*64)]:
            f=fixture();f[0][key]=value
            with self.subTest(key=key,value=value),self.assertRaises(m.Stopped):self.validate(f)

    def test_review_pins_prior_receipt_bytes_and_both_image_config_identities(self):
        for key in ["originalApprovedServerImageRepoDigest","reviewedServerImageTransportSha256",
                    "serverImageId","serverImageSemanticConfigSha256"]:
            f=fixture();f[0].pop(key)
            with self.subTest(missing=key),self.assertRaises(m.Stopped):self.validate(f)
        for key,value in [("reviewedServerImageTransportSha256","0"*64),
                          ("serverImageId","sha256:"+"0"*64),
                          ("serverImageSemanticConfigSha256","0"*64)]:
            f=fixture();f[0][key]=value
            with self.subTest(key=key),self.assertRaises(m.Stopped):self.validate(f)
        f=fixture();f[2]["nativeProbe"]["receipt"]["serverImageTransport"]["buildxVersion"]+=" changed"
        with self.assertRaisesRegex(m.Stopped,"reviewed_server_transport_pin_mismatch"):self.validate(f)

    def test_prior_receipt_cannot_forge_origin_or_claim_unperformed_manual_hashing(self):
        invalid=[("operation","some-other-qualifier"),("originalEcrReference",m.SERVER_IMAGE),
            ("transportReference",m.ORIGINAL_SERVER_IMAGE),("contentDigest","sha256:"+"0"*64),
            ("manifestSha256","0"*64),("actualRepoDigest",m.ORIGINAL_SERVER_IMAGE),
            ("actualRepoDigest","docker.io/supabase/postgres@sha256:"+"0"*64),
            ("imageId","4"*64),("imageId",[]),("actualRepoDigest",[]),
            ("semanticConfigSha256","x"*64),("semanticConfigSha256",{}),
            ("manifestDescriptorCount",5),("manifestDescriptorCount",True),
            ("compressedLayerCount",False),("compressedLayerCount",0),("compressedLayerCount",257),
            ("buildxVersion",""),("buildxVersion","unsafe\nversion"),("buildxVersion","v"*513),
            ("engineVerificationContract","manual-client-download"),("manualLayerHashingPerformed",True)]
        for key,value in invalid:
            f=fixture();receipt=f[2]["nativeProbe"]["receipt"]["serverImageTransport"];receipt[key]=value
            f[0]["reviewedServerImageTransportSha256"]=m.sha(m.canonical(receipt))
            with self.subTest(key=key,value=value),self.assertRaisesRegex(m.Stopped,"server_transport_proof_unqualified"):
                self.validate(f)
        for change in [lambda r:r.pop("manifestDescriptorCount"),lambda r:r.update(unreviewedField=True)]:
            f=fixture();receipt=f[2]["nativeProbe"]["receipt"]["serverImageTransport"];change(receipt)
            f[0]["reviewedServerImageTransportSha256"]=m.sha(m.canonical(receipt))
            with self.assertRaisesRegex(m.Stopped,"server_transport_proof_unqualified"):self.validate(f)

    def test_fresh_honest_alias_and_buildx_version_change_bind_the_fresh_receipt(self):
        f=fixture();reviewed=self.validate(f)
        fresh=f[4]["serverImageTransport"]
        fresh["actualRepoDigest"]="supabase/postgres@"+m.CONTENT_DIGEST
        fresh["buildxVersion"]="github.com/docker/buildx v0.25.0 synthetic"
        f[4]["serverImageRepoDigest"]=fresh["actualRepoDigest"]
        proof=m.bound_fresh_attestation(reviewed,f[4],now=NOW)
        self.assertNotEqual(proof["serverImageTransportSha256"],f[0]["reviewedServerImageTransportSha256"])
        self.assertEqual(proof["serverImageTransportSha256"],m.sha(m.canonical(fresh)))
        self.assertEqual(proof["serverImageTransport"],fresh)
        self.assertEqual(proof["actualImageRepoDigest"],fresh["actualRepoDigest"])
        self.assertEqual(proof["originalApprovedImageRepoDigest"],m.ORIGINAL_SERVER_IMAGE)
        self.assertEqual(proof["serverImageId"],f[0]["serverImageId"])
        self.assertEqual(proof["serverImageSemanticConfigSha256"],f[0]["serverImageSemanticConfigSha256"])

    def test_fresh_receipt_requires_prior_content_identity_and_observed_origin_consistency(self):
        for key,value in [("imageId","sha256:"+"0"*64),("semanticConfigSha256","0"*64),
              ("originalEcrReference",m.SERVER_IMAGE),("actualRepoDigest",m.ORIGINAL_SERVER_IMAGE),
              ("actualRepoDigest","docker.io/supabase/postgres@sha256:"+"0"*64),
              ("actualRepoDigest","supabase/postgres@"+m.CONTENT_DIGEST)]:
            f=fixture();reviewed=self.validate(f);f[4]["serverImageTransport"][key]=value
            with self.subTest(key=key,value=value),self.assertRaises(m.Stopped):
                m.bound_fresh_attestation(reviewed,f[4],now=NOW)
        f=fixture();reviewed=self.validate(f);f[4].pop("serverImageTransport")
        with self.assertRaises(m.Stopped):m.bound_fresh_attestation(reviewed,f[4],now=NOW)

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
