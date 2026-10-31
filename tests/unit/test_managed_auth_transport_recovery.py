"""Synthetic private attestation files only; no registry, Docker, SQL or data.

These tests exercise the real recovery attestation parser and hash checks. The
completed image-qualifier receipt is a synthetic boundary fixture, not evidence
that a registry pull or a real isolated recovery occurred.
"""
import copy
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT=Path(__file__).resolve().parents[2]/"scripts/release/managed-auth-recovery.py"
spec=importlib.util.spec_from_file_location("managed_auth_transport_recovery",SCRIPT)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
NOW=1800000000
CONTENT="sha256:3e2a7ab48783077d0122dc72ed5174afb543110c38266c845716c51d130658e4"
ORIGINAL="public.ecr.aws/supabase/postgres@"+CONTENT
HUB="docker.io/supabase/postgres@"+CONTENT
FAMILIAR="supabase/postgres@"+CONTENT


def stamp(seconds):return datetime.fromtimestamp(seconds,timezone.utc).isoformat()


def fixture():
    transport={"operation":"verified-official-server-image-transport",
        "originalEcrReference":ORIGINAL,"transportReference":HUB,"contentDigest":CONTENT,
        "manifestSha256":CONTENT.removeprefix("sha256:"),"manifestDescriptorCount":4,
        "compressedLayerCount":3,"imageId":"sha256:"+"4"*64,"actualRepoDigest":HUB,
        "buildxVersion":"github.com/docker/buildx v0.24.0 synthetic","semanticConfigSha256":"5"*64,
        "engineVerificationContract":"docker-engine-digest-pinned-pull","manualLayerHashingPerformed":False}
    return {"format":1,"sourceProject":m.PROJECT,"postgresBuild":"17.6.1.155",
        "imageTag":"public.ecr.aws/supabase/postgres:17.6.1.155","actualImageRepoDigest":HUB,
        "originalApprovedImageRepoDigest":ORIGINAL,"serverImageTransport":transport,
        "serverImageTransportSha256":m.digest(m.encoded(transport)),
        "serverImageId":transport["imageId"],"serverImageSemanticConfigSha256":transport["semanticConfigSha256"],
        "networkEvidenceSha256":"3"*64,"productionRoutesDenied":True,"internetEgressDenied":True,
        "consumersStopped":True,"cronLaunchActiveJobs":False,"independentlyReviewed":True,
        "observedAt":stamp(NOW-2),"host":"synthetic-target.internal","database":"postgres",
        "port":5432,"serverIp":"172.30.240.2","systemIdentifier":"123456789"}


class TransportRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)/"synthetic-attestation.json"

    def read(self,value,*,bind_transport=True,bind_file=True):
        value=copy.deepcopy(value)
        if bind_transport and "serverImageTransport" in value:
            value["serverImageTransportSha256"]=m.digest(m.encoded(value["serverImageTransport"]))
        raw=json.dumps(value,indent=2).encode()
        self.path.write_bytes(raw);os.chmod(self.path,0o600)
        env={"KOVA_AUTH_RESTORE_ATTESTATION":str(self.path),
             "KOVA_AUTH_RESTORE_ATTESTATION_SHA256":m.digest(raw) if bind_file else "0"*64}
        with patch.object(m.time,"time",return_value=NOW):return m.attest(env)

    def test_exact_approved_content_pin_and_honest_hub_provenance_are_retained(self):
        self.assertEqual(m.SERVER_CONTENT_DIGEST,CONTENT)
        self.assertEqual(m.ORIGINAL_SERVER_IMAGE,ORIGINAL)
        self.assertEqual(m.SERVER_TRANSPORT_IMAGE,HUB)
        f=fixture();actual=self.read(f)
        self.assertEqual(actual,f)
        self.assertEqual(actual["actualImageRepoDigest"],HUB)
        self.assertEqual(actual["originalApprovedImageRepoDigest"],ORIGINAL)
        self.assertEqual(actual["imageTag"],"public.ecr.aws/supabase/postgres:17.6.1.155")
        self.assertFalse(actual["serverImageTransport"]["manualLayerHashingPerformed"])

    def test_familiar_hub_alias_and_new_buildx_version_bind_actual_fresh_receipt(self):
        f=fixture();old_hash=f["serverImageTransportSha256"]
        f["actualImageRepoDigest"]=FAMILIAR;f["serverImageTransport"]["actualRepoDigest"]=FAMILIAR
        f["serverImageTransport"]["buildxVersion"]="github.com/docker/buildx v0.25.0 synthetic"
        actual=self.read(f)
        self.assertEqual(actual["actualImageRepoDigest"],FAMILIAR)
        self.assertEqual(actual["serverImageTransport"]["actualRepoDigest"],FAMILIAR)
        self.assertEqual(actual["originalApprovedImageRepoDigest"],ORIGINAL)
        self.assertNotEqual(actual["serverImageTransportSha256"],old_hash)
        self.assertEqual(actual["serverImageTransportSha256"],m.digest(m.encoded(actual["serverImageTransport"])))

    def test_outer_file_and_inner_fresh_receipt_are_independently_hash_bound(self):
        with self.assertRaisesRegex(m.Stopped,"isolation_attestation_unbound"):
            self.read(fixture(),bind_file=False)
        f=fixture();f["serverImageTransport"]["buildxVersion"]+=" changed"
        with self.assertRaisesRegex(m.Stopped,"isolation_server_transport_unqualified"):
            self.read(f,bind_transport=False)
        f=fixture();f["serverImageTransportSha256"]="0"*64
        with self.assertRaisesRegex(m.Stopped,"isolation_server_transport_unqualified"):
            self.read(f,bind_transport=False)

    def test_old_ecr_only_or_missing_receipt_never_establishes_hub_qualification(self):
        f=fixture()
        for key in ["serverImageTransport","serverImageTransportSha256","serverImageId",
                    "serverImageSemanticConfigSha256","originalApprovedImageRepoDigest"]:
            missing=copy.deepcopy(f);missing.pop(key)
            with self.subTest(missing=key),self.assertRaisesRegex(m.Stopped,"isolation_server_transport_unqualified"):
                self.read(missing,bind_transport=False)
        f={k:v for k,v in f.items() if not k.startswith("serverImage") and k!="originalApprovedImageRepoDigest"}
        f["actualImageRepoDigest"]=ORIGINAL
        with self.assertRaisesRegex(m.Stopped,"isolation_server_transport_unqualified"):self.read(f)

    def test_rehash_cannot_substitute_other_digest_tag_registry_or_original_origin(self):
        invalid=[("originalEcrReference",HUB),("originalEcrReference",ORIGINAL.replace("3e2a","0e2a")),
            ("transportReference",ORIGINAL),("transportReference","docker.io/supabase/postgres:17.6.1.155"),
            ("transportReference","mirror.invalid/supabase/postgres@"+CONTENT),
            ("contentDigest","sha256:"+"0"*64),("manifestSha256","0"*64),
            ("actualRepoDigest",ORIGINAL),("actualRepoDigest","docker.io/supabase/postgres@sha256:"+"0"*64),
            ("actualRepoDigest","mirror.invalid/supabase/postgres@"+CONTENT)]
        for key,value in invalid:
            f=fixture();f["serverImageTransport"][key]=value
            with self.subTest(key=key,value=value),self.assertRaisesRegex(m.Stopped,"isolation_server_transport_unqualified"):
                self.read(f)
        f=fixture();f["originalApprovedImageRepoDigest"]=HUB
        with self.assertRaisesRegex(m.Stopped,"isolation_server_transport_unqualified"):self.read(f)

    def test_receipt_image_and_config_identity_must_equal_reviewed_attestation_pins(self):
        for scope,key,value in [("transport","imageId","sha256:"+"0"*64),
                ("transport","semanticConfigSha256","0"*64),
                ("attestation","serverImageId","sha256:"+"0"*64),
                ("attestation","serverImageSemanticConfigSha256","0"*64)]:
            f=fixture();(f["serverImageTransport"] if scope=="transport" else f)[key]=value
            with self.subTest(scope=scope,key=key),self.assertRaisesRegex(m.Stopped,"isolation_server_transport_unqualified"):
                self.read(f)

    def test_actual_observed_repo_cannot_be_relabelled_as_original_ecr(self):
        for value in [ORIGINAL,FAMILIAR,"docker.io/supabase/postgres@sha256:"+"0"*64]:
            f=fixture();f["actualImageRepoDigest"]=value
            with self.subTest(value=value),self.assertRaisesRegex(m.Stopped,"isolation_attestation_rejected"):
                self.read(f)

    def test_exact_safe_receipt_schema_and_literal_engine_contract_are_required(self):
        for key in fixture()["serverImageTransport"]:
            f=fixture();f["serverImageTransport"].pop(key)
            with self.subTest(missing=key),self.assertRaisesRegex(m.Stopped,"isolation_server_transport_unqualified"):
                self.read(f)
        for key,value in [("operation","unreviewed-qualifier"),("engineVerificationContract","manual-client-download"),
                          ("manualLayerHashingPerformed",True),("manualLayerHashingPerformed",0)]:
            f=fixture();f["serverImageTransport"][key]=value
            with self.subTest(key=key),self.assertRaisesRegex(m.Stopped,"isolation_server_transport_unqualified"):self.read(f)
        f=fixture();f["serverImageTransport"]["extraProof"]=True
        with self.assertRaisesRegex(m.Stopped,"isolation_server_transport_unqualified"):self.read(f)

    def test_layer_counts_buildx_and_hash_types_are_validated_even_with_new_matching_hash(self):
        invalid=[("manifestDescriptorCount",5),("manifestDescriptorCount",True),
            ("compressedLayerCount",False),("compressedLayerCount",0),("compressedLayerCount",257),
            ("compressedLayerCount",3.0),("buildxVersion",""),("buildxVersion","v"*513),
            ("buildxVersion","v\nunsafe"),("buildxVersion",[]),("imageId",[]),
            ("imageId","4"*64),("semanticConfigSha256",{}),("semanticConfigSha256","x"*64),
            ("actualRepoDigest",[])]
        for key,value in invalid:
            f=fixture();f["serverImageTransport"][key]=value
            with self.subTest(key=key,value=value),self.assertRaisesRegex(m.Stopped,"isolation_server_transport_unqualified"):
                self.read(f)

    def test_existing_isolation_and_clock_requirements_remain_mandatory(self):
        for key,value in [("productionRoutesDenied",False),("internetEgressDenied",False),
                ("consumersStopped",False),("cronLaunchActiveJobs",True),("independentlyReviewed",False),
                ("imageTag","docker.io/supabase/postgres:17.6.1.155"),("postgresBuild","17.6.1.156")]:
            f=fixture();f[key]=value
            with self.subTest(key=key),self.assertRaisesRegex(m.Stopped,"isolation_attestation_rejected"):self.read(f)
        for observed in [NOW-901,NOW+6]:
            f=fixture();f["observedAt"]=stamp(observed)
            with self.subTest(observed=observed),self.assertRaisesRegex(m.Stopped,"isolation_attestation_stale"):self.read(f)

    def test_invalid_transport_stops_real_restore_before_guard_phrase_or_decrypt(self):
        f=fixture();f["serverImageTransport"]["actualRepoDigest"]=ORIGINAL
        raw=m.encoded(f);self.path.write_bytes(raw);os.chmod(self.path,0o600)
        env={"KOVA_AUTH_RESTORE_ATTESTATION":str(self.path),"KOVA_AUTH_RESTORE_ATTESTATION_SHA256":m.digest(raw),
             "KOVA_AUTH_RECOVERY_CONFIRMATION":"RESTORE_EMPTY_ISOLATED"}
        with patch.object(m,"run") as command,patch.object(m,"passphrase") as phrase,patch.object(m,"crypt") as decrypt:
            with self.assertRaisesRegex(m.Stopped,"isolation_server_transport_unqualified"):
                m.restore(env,Path(self.temp.name)/"absent-ciphertext.gpg",Path(self.temp.name)/"absent-output")
            command.assert_not_called();phrase.assert_not_called();decrypt.assert_not_called()

    def test_transport_failure_diagnostic_is_static_and_public(self):
        actual=m.public_failure(m.Stopped("isolation_server_transport_unqualified"))
        self.assertEqual(actual["code"],"isolation_server_transport_unqualified")
        self.assertEqual(m.public_failure(m.Stopped("private-source-url-canary"))["code"],"unclassified_private_failure")


if __name__=="__main__":unittest.main()
