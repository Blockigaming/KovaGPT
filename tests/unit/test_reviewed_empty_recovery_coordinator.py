"""Data-free adversarial coordinator checks: no Docker, GitHub, SQL or secrets."""
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import io
import json
import os
import shutil
from pathlib import Path
import stat
import subprocess
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import warnings
import zipfile

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/release/run-reviewed-empty-recovery.py"
spec = importlib.util.spec_from_file_location("reviewed_coordinator_tests", SCRIPT)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
SOURCE = "b" * 40


def private(path, raw):
    path.write_bytes(raw)
    path.chmod(0o600)
    return path


def environment(root):
    return {"GITHUB_ACTIONS": "true", "RUNNER_OS": "Linux", "GITHUB_EVENT_NAME": "workflow_dispatch",
            "GITHUB_REPOSITORY": m.REPO, "GITHUB_REF": "refs/heads/main", "GITHUB_ACTOR": "Blockigaming",
            "GITHUB_REPOSITORY_OWNER": "Blockigaming", "GITHUB_SHA": SOURCE,
            "KOVA_APPROVED_SOURCE_SHA": SOURCE, "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1",
            "RUNNER_TEMP": str(root), "KOVA_REVIEWED_RECOVERY_CONFIRMATION": "RESTORE_REVIEWED_PRIVATE_EMPTY_ONLY"}


def github_fixture(kind):
    pin = {"artifactId": 12, "runId": 34, "sourceSha": SOURCE, "receiptSha256": "a" * 64}
    artifact = {"id": 12, "expired": False, "size_in_bytes": 100,
                "workflow_run": {"id": 34, "head_sha": SOURCE},
                "name": m.ARTIFACTS[kind]["prefix"] + SOURCE + "-34-2"}
    run = {"id": 34, "head_sha": SOURCE, "head_branch": "main", "event": "workflow_dispatch",
           "status": "completed", "conclusion": "success", "repository": {"full_name": m.REPO},
           "path": m.ARTIFACTS[kind]["workflow"], "run_attempt": 2}
    return pin, artifact, run


def oci_archive(path):
    """A complete tiny OCI digest chain, containing only synthetic bytes."""
    layer = b"synthetic fixture layer only\n"
    config = m.canonical({"architecture":"amd64","os":"linux","config":{"User":"65532:65532",
        "Env":["PATH=/usr/bin"],"Entrypoint":["python3","/opt/kova/scripts/release/recovery-operator-client-smoke.py"],
        "WorkingDir":"/tmp","Labels":{"org.opencontainers.image.revision":SOURCE,"org.kova.recovery.owner":"b"*24}},
        "rootfs":{"type":"layers","diff_ids":["sha256:"+m.sha(layer)]}})
    descriptor = lambda raw: {"digest": "sha256:" + m.sha(raw), "size": len(raw)}
    manifest = m.canonical({"schemaVersion": 2, "config": descriptor(config), "layers": [descriptor(layer)]})
    entries = {"oci-layout": m.canonical({"imageLayoutVersion": "1.0.0"}),
               "index.json": m.canonical({"schemaVersion": 2, "manifests": [descriptor(manifest)]}),
               **{"blobs/sha256/" + m.sha(raw): raw for raw in [manifest, config, layer]}}
    with tarfile.open(path, "w:") as package:
        for name, raw in entries.items():
            info = tarfile.TarInfo(name); info.size = len(raw)
            package.addfile(info, io.BytesIO(raw))
    return "sha256:" + m.sha(config)


class CoordinatorTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.env = environment(self.root)

    def test_context_requires_owner_manual_exact_main_and_approved_source(self):
        self.assertEqual(m.context(self.env), self.root)
        for key, value in [("GITHUB_ACTOR", "someone-else"), ("GITHUB_EVENT_NAME", "pull_request"),
                           ("GITHUB_REF", "refs/heads/other"), ("GITHUB_REPOSITORY", "foreign/repo"),
                           ("KOVA_APPROVED_SOURCE_SHA", "c" * 40), ("RUNNER_OS", "Windows"),
                           ("KOVA_REVIEWED_RECOVERY_CONFIRMATION", "yes")]:
            with self.subTest(key=key), self.assertRaises(m.Stopped):
                m.context({**self.env, key: value})

    def test_source_credentials_are_rejected_before_reading_inputs_or_taking_actions(self):
        forbidden = ["KOVA_PRODUCTION_DATABASE_URL", "KOVA_PRODUCTION_OTHER_URL", "PGPASSWORD",
                     "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "KOVA_AUTH_JWT_PRIVATE_KEY",
                     "APPROVED_ISOLATED_PG17_DATABASE_URL", "KOVA_AUTH_RESTORE_ATTESTATION"]
        for key in forbidden:
            with self.subTest(key=key), patch.object(m, "private_file") as read, patch.object(m, "command") as action:
                with self.assertRaisesRegex(m.Stopped, "source_or_unreviewed_credentials"):
                    m.Coordinator({**self.env, key: "synthetic-forbidden-canary"}, "absent", "0" * 64,
                                  "absent-metadata", self.root / "receipt.json")
                read.assert_not_called(); action.assert_not_called()
        # The already approved phrase may enter the host coordinator, but no host
        # subprocess environment receives it (or GitHub/production credentials).
        allowed = {**self.env, "PATH": "/synthetic/bin", "GH_TOKEN": "synthetic-gh-token",
                   "KOVA_PRODUCTION_BACKUP_PASSPHRASE": "synthetic-phrase-" * 3}
        self.assertEqual(m.context(allowed), self.root)
        self.assertEqual(m.sanitized_host_env(allowed), {"PATH": "/synthetic/bin"})

    def test_private_inputs_reject_public_permissions_symlinks_empty_and_oversize(self):
        path = private(self.root / "input.json", b"{}")
        self.assertEqual(m.private_file(path, 2), b"{}")
        for mode in [0o644, 0o640, 0o601]:
            path.chmod(mode)
            with self.subTest(mode=mode), self.assertRaises(m.Stopped): m.private_file(path, 2)
        path.chmod(0o600)
        with self.assertRaises(m.Stopped): m.private_file(path, 1)
        link = self.root / "link.json"; link.symlink_to(path)
        with self.assertRaises(m.Stopped): m.private_file(link, 2)
        path.write_bytes(b"")
        with self.assertRaises(m.Stopped): m.private_file(path, 2)
        with self.assertRaisesRegex(m.Stopped, "duplicate_key"): m.strict_json(b'{"pin":1,"pin":2}')

    def test_constructor_checks_actual_checkout_with_only_sanitized_environment(self):
        raw = m.canonical({"sourceSha": SOURCE})
        manifest = private(self.root / "manifest.json", raw)
        metadata = private(self.root / "metadata.json", b"{}")
        env = {**self.env, "PATH": "/synthetic/bin", "GH_TOKEN": "SYNTHETIC_GH_CANARY",
               "KOVA_PRODUCTION_BACKUP_PASSPHRASE": "SYNTHETIC_PHRASE_CANARY_" * 3}
        for actual, accepted in [(SOURCE, True), ("c" * 40, False)]:
            with self.subTest(actual=actual), patch.object(m.base, "validate_metadata", return_value={}), \
                 patch.object(m, "command", return_value=(actual + "\n").encode()) as action:
                if accepted:
                    m.Coordinator(env, manifest, m.sha(raw), metadata, self.root / "receipt.json")
                else:
                    with self.assertRaisesRegex(m.Stopped, "checkout_source_mismatch"):
                        m.Coordinator(env, manifest, m.sha(raw), metadata, self.root / "receipt.json")
                action.assert_called_once_with(["git", "rev-parse", "HEAD"], {"PATH": "/synthetic/bin"}, timeout=5)

    def test_input_hash_and_output_scope_fail_before_checkout_or_native_actions(self):
        raw = m.canonical({"sourceSha": SOURCE})
        manifest = private(self.root / "manifest.json", raw)
        for output, digest in [(self.root / "other.json", m.sha(raw)), (self.root.parent / "receipt.json", m.sha(raw)),
                               (self.root / "receipt.json", "0" * 64)]:
            with self.subTest(output=str(output), digest=digest), patch.object(m, "command") as action:
                with self.assertRaises(m.Stopped): m.Coordinator(self.env, manifest, digest, "missing-metadata", output)
                action.assert_not_called()

    def test_artifact_api_identity_rejects_expiry_wrong_id_run_head_size_and_foreign_run(self):
        for kind in m.ARTIFACTS:
            pin, artifact, run = github_fixture(kind)
            m.verified_github_identity(kind, pin, artifact, run)
            for key, value in [("id", 99), ("expired", True), ("size_in_bytes", 0),
                               ("size_in_bytes", True), ("size_in_bytes", m.MAX_ZIP + 1),
                               ("workflow_run", {"id": 999, "head_sha": SOURCE}),
                               ("workflow_run", {"id": 34, "head_sha": "c" * 40})]:
                with self.subTest(kind=kind, key=key, value=value), self.assertRaises(m.Stopped):
                    m.verified_github_identity(kind, pin, {**artifact, key: value}, run)
            for key, value in [("id", 99), ("head_sha", "c" * 40), ("head_branch", "other"),
                               ("event", "pull_request"), ("status", "in_progress"), ("conclusion", "failure"),
                               ("repository", {"full_name": "foreign/repo"}), ("path", "unreviewed.yml"),
                               ("run_attempt", 0), ("run_attempt", True)]:
                with self.subTest(kind=kind, key=key, value=value), self.assertRaises(m.Stopped):
                    m.verified_github_identity(kind, pin, artifact, {**run, key: value})

    def test_artifact_name_binds_kind_source_run_and_attempt(self):
        for kind in m.ARTIFACTS:
            pin, artifact, run = github_fixture(kind)
            for name in [artifact["name"] + "-extra", artifact["name"].replace(SOURCE, "c" * 40),
                         artifact["name"].removesuffix("2") + "1", "foreign-prefix-" + SOURCE + "-34-2"]:
                with self.subTest(kind=kind, name=name), self.assertRaisesRegex(m.Stopped, "artifact_name_mismatch"):
                    m.verified_github_identity(kind, pin, {**artifact, "name": name}, run)

    def test_fetch_verifies_api_before_download_and_keeps_phrase_out_of_gh_environment(self):
        manifest = {}; metadata = {}; receipt_raw = b'{"synthetic":true}\n'
        for kind in m.ARTIFACTS:
            pin, artifact, run = github_fixture(kind)
            pin["receiptSha256"] = m.sha(receipt_raw)
            if kind == "operatorClient":
                pin.update(imageId="sha256:" + "d" * 64, inventorySha256="e" * 64,
                           archiveSha256="f" * 64, archiveBytes=123)
            manifest[kind] = pin; metadata[kind] = (artifact, run)
        calls = []
        def command(args, env, **kwargs):
            calls.append((args, env, kwargs))
            kind = list(m.ARTIFACTS)[(len(calls) - 1) // 3]
            artifact, run = metadata[kind]
            if "output" not in kwargs:
                return m.canonical(run if "/runs/" in args[-1] else artifact)
            with zipfile.ZipFile(kwargs["output"], "w") as archive:
                for name in m.ARTIFACTS[kind]["files"]:
                    archive.writestr(name, receipt_raw if name == m.ARTIFACTS[kind]["receipt"] else b"synthetic fixture")
            return b""
        env = {**self.env, "GH_TOKEN": "SYNTHETIC_GH_CANARY", "PATH": "/synthetic/bin",
               "KOVA_PRODUCTION_BACKUP_PASSPHRASE": "SYNTHETIC_PHRASE_CANARY_" * 3}
        with patch.object(m, "command", side_effect=command): receipts, paths = m.fetch_artifacts(manifest, self.root, env)
        self.assertEqual(set(receipts), set(m.ARTIFACTS)); self.assertEqual(len(calls), 9)
        for kind in m.ARTIFACTS:
            self.assertTrue(receipts[kind]["githubIdentityVerified"])
            self.assertEqual(receipts[kind]["receiptSha256"], m.sha(receipt_raw))
            self.assertTrue(paths[kind].is_dir()); self.assertFalse((self.root / (kind + ".zip")).exists())
        for _, actual_env, _ in calls:
            self.assertEqual(actual_env, {"PATH": "/synthetic/bin", "GH_TOKEN": "SYNTHETIC_GH_CANARY"})

    def test_bad_artifact_api_identity_prevents_archive_download(self):
        pin, artifact, run = github_fixture("nativeProbe"); artifact["expired"] = True
        with patch.object(m, "command", side_effect=[m.canonical(artifact), m.canonical(run)]) as action:
            with self.assertRaisesRegex(m.Stopped, "artifact_api_identity"):
                m.fetch_artifacts({"nativeProbe": pin}, self.root, {"GH_TOKEN": "SYNTHETIC_GH_CANARY"})
        self.assertEqual(action.call_count, 2)
        self.assertFalse(any("output" in call.kwargs for call in action.call_args_list))

    def test_zip_allows_only_exact_regular_members_and_private_outputs(self):
        path = self.root / "valid.zip"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("receipt.json", b"{}")
            archive.writestr("ciphertext.gpg", b"synthetic ciphertext")
        output = self.root / "unpacked"
        m.unpack_artifact(path, output, {"receipt.json": 10, "ciphertext.gpg": 100})
        self.assertEqual(output.stat().st_mode & 0o777, 0o700)
        for member in output.iterdir(): self.assertEqual(member.stat().st_mode & 0o777, 0o600)
        with self.assertRaisesRegex(m.Stopped, "output_exists"):
            m.unpack_artifact(path, output, {"receipt.json": 10, "ciphertext.gpg": 100})

    def test_zip_rejects_symlink_traversal_absolute_duplicate_directory_empty_and_size(self):
        for label, entries, maximum in [
                ("traversal", [("../receipt.json", b"{}", None)], 10),
                ("absolute", [("/receipt.json", b"{}", None)], 10),
                ("symlink", [("receipt.json", b"outside", stat.S_IFLNK | 0o777)], 10),
                ("duplicate", [("receipt.json", b"{}", None), ("receipt.json", b"{}", None)], 10),
                ("directory", [("receipt.json/", b"x", stat.S_IFDIR | 0o700)], 10),
                ("empty", [("receipt.json", b"", None)], 10),
                ("large", [("receipt.json", b"12345", None)], 4)]:
            path = self.root / (label + ".zip")
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                with zipfile.ZipFile(path, "w") as archive:
                    for name, raw, mode in entries:
                        info = zipfile.ZipInfo(name)
                        if mode is not None: info.external_attr = mode << 16
                        archive.writestr(info, raw)
            with self.subTest(label=label), self.assertRaises(m.Stopped):
                m.unpack_artifact(path, self.root / (label + "-out"), {"receipt.json": maximum})
        self.assertFalse((self.root.parent / "receipt.json").exists())

    def operator_fixture(self):
        directory = self.root / "operatorClient"; directory.mkdir()
        archive = directory / "operator-client.oci.tar"
        image_id = oci_archive(archive)
        document=json.loads(m.builder.inspect_oci(archive)["configBytes"])
        config={**document["config"],"Healthcheck":{"Test":["NONE"]},"Shell":["/bin/bash","-o","pipefail","-c"]}
        built_id="sha256:"+m.sha(m.canonical(config))
        built={"Id":built_id,"Os":"linux","Architecture":"amd64","Config":config,
            "RootFS":{"Type":"layers","Layers":document["rootfs"]["diff_ids"]}}
        binding=m.builder.verify_oci_runtime_binding(built,document,source_sha=SOURCE,owner="b"*24)
        inventory = {"format":2,"nativeOciArchiveRoundtripSmokePassed":True,
                     "ociConfigDigest":image_id,"buildClientImageId":built_id,
                     "genericBuildImage":built,"ociRuntimeBinding":binding,
                     "clientImageId": image_id, "sourceSha": SOURCE,
                     "genericSourceSha256": {name: m.builder.file_sha(m.HERE / name) for name in [*m.builder.FILES,"recovery-operator-client.Dockerfile"]}}
        raw = m.canonical(inventory)
        private(directory / "client-image-inventory.json", raw)
        pin = {"imageId": image_id, "sourceSha": SOURCE, "inventorySha256": m.sha(raw),
               "archiveSha256": m.builder.file_sha(archive), "archiveBytes": archive.stat().st_size}
        calls = []
        def run(args, **kwargs):
            calls.append((args, kwargs))
            if args[:3] == ["docker", "image", "inspect"]: return m.canonical([{"Id": image_id}])
            return b""
        return {"operatorClient": pin}, {"operatorClient": directory}, inventory, calls, run

    def test_exact_oci_inventory_and_all_current_source_files_are_checked_before_load(self):
        plan, paths, inventory, calls, run = self.operator_fixture()
        self.assertEqual(m.load_exact_operator(plan, paths, run, "synthetic-tag"), inventory)
        self.assertEqual([c[0][:2] for c in calls], [["docker", "image"], ["skopeo", "copy"], ["docker", "image"]])
        self.assertEqual(calls[1][0][-1], "docker-daemon:synthetic-tag")

    def test_missing_native_roundtrip_or_archive_identity_binding_stops_before_load(self):
        for key,value in [("format",1),("nativeOciArchiveRoundtripSmokePassed",False),
                          ("ociConfigDigest","sha256:"+"f"*64),("buildClientImageId","unmeasured")]:
            directory=self.root/"operatorClient"
            if directory.exists():shutil.rmtree(directory)
            plan,paths,inventory,calls,run=self.operator_fixture()
            inventory[key]=value;raw=m.canonical(inventory)
            (paths["operatorClient"]/"client-image-inventory.json").write_bytes(raw)
            plan["operatorClient"]["inventorySha256"]=m.sha(raw)
            with self.subTest(key=key),self.assertRaises(m.Stopped):m.load_exact_operator(plan,paths,run,"synthetic-tag")
            self.assertEqual(calls,[])

    def test_hub_verifier_is_reviewed_host_code_outside_exact_client_source_allowlists(self):
        expected = ["managed-auth-recovery.py", "managed-auth-recovery-target.mjs", "verify-isolated-restore-target.mjs",
                    "empty-restore-target-catalog.sql", "recovery-operator-client-smoke.py", "run-isolated-recovery-client.py",
                    "extension-semantic-capture.py", "extension-routine-type-payloads.py",
                    "extension-routine-type-hash-query.py", "extension-relation-payloads.py",
                    "extension-relation-query-hooks.py", "pg17-extension-relation-manifest.json",
                    "canonicalize-pg17-extension-nodes.py", "pg17-extension-node-schema.json",
                    "extension-regclass-datum-byteorder-audit.sql"]
        client = m.module("reviewed_client_source_allowlist", "recovery-operator-client-smoke.py")
        self.assertEqual(len(expected), 15)
        self.assertEqual(m.builder.FILES, expected)
        self.assertEqual(client.SOURCE_NAMES, expected)
        self.assertIn("verified-server-image.py", m.review.RECIPE_FILES)
        self.assertNotIn("verified-server-image.py", m.builder.FILES)
        self.assertNotIn("verified-server-image.py", client.SOURCE_NAMES)
        context = self.root / "generic-context"; context.mkdir()
        source_hashes = m.builder.source_context(context)
        self.assertEqual(set(source_hashes), set(expected) | {"recovery-operator-client.Dockerfile"})
        self.assertEqual({path.name for path in (context / "source").iterdir()}, set(expected))

    def test_archive_inventory_source_closure_or_loaded_id_mismatch_never_qualifies(self):
        plan, paths, inventory, calls, run = self.operator_fixture()
        original = copy.deepcopy(plan)
        for key, value in [("archiveSha256", "0" * 64), ("archiveBytes", 1), ("inventorySha256", "0" * 64)]:
            plan = copy.deepcopy(original); plan["operatorClient"][key] = value; calls.clear()
            with self.subTest(key=key), self.assertRaises(Exception): m.load_exact_operator(plan, paths, run, "synthetic-tag")
            self.assertFalse(calls)
        for key, value in [("sourceSha", "c" * 40), ("clientImageId", "sha256:" + "0" * 64),
                           ("genericSourceSha256", {})]:
            changed = {**inventory, key: value}; raw = m.canonical(changed)
            private(paths["operatorClient"] / "client-image-inventory.json", raw)
            plan = copy.deepcopy(original); plan["operatorClient"]["inventorySha256"] = m.sha(raw); calls.clear()
            with self.subTest(key=key), self.assertRaisesRegex(m.Stopped, "source_closure"):
                m.load_exact_operator(plan, paths, run, "synthetic-tag")
            self.assertFalse(calls)
        private(paths["operatorClient"] / "client-image-inventory.json", m.canonical(inventory))
        def wrong_loaded(args, **kwargs):
            if args[:3] == ["docker", "image", "inspect"]: return m.canonical([{"Id": "sha256:" + "0" * 64}])
            return b""
        with self.assertRaisesRegex(m.Stopped, "loaded_operator_id"):
            m.load_exact_operator(original, paths, wrong_loaded, "synthetic-tag")
        with self.assertRaisesRegex(m.Stopped, "tag_already_exists"):
            m.load_exact_operator(original, paths, lambda *a, **k: b"existing-tag", "synthetic-tag")

    def test_oci_digest_chain_is_checked_even_if_outer_archive_hash_was_re_pinned(self):
        plan, paths, _, calls, run = self.operator_fixture()
        archive = paths["operatorClient"] / "operator-client.oci.tar"
        raw = archive.read_bytes().replace(b"synthetic fixture layer only", b"untrusted fixture layer only")
        archive.write_bytes(raw)
        plan["operatorClient"].update(archiveSha256=m.sha(raw), archiveBytes=len(raw))
        with self.assertRaises(Exception): m.load_exact_operator(plan, paths, run, "synthetic-tag")
        self.assertFalse(calls)

    def bare_coordinator(self):
        p = object.__new__(m.Coordinator)
        p.root = self.root; p.env = dict(self.env); p.safe_env = {"PATH": "/synthetic/bin"}
        p.probe = None; p.image_loaded = False; p.private_root = None; p.tag = None
        p.stage = "review-input"; p.import_pending = False; p.manifest_sha = "a" * 64
        p.manifest = {"operatorClient": {"imageId": "sha256:" + "d" * 64}}
        p.output = self.root / "receipt.json"; p.state_path = self.root / "owned.json"
        return p

    def test_import_outcome_is_distinguished_from_known_completed_failure(self):
        for completed in [False, True]:
            p = self.bare_coordinator(); saved = []
            with self.subTest(completed=completed), patch.object(p, "save_state", side_effect=lambda: saved.append(p.import_pending)), \
                 patch.object(m, "command", side_effect=m.HostCommandStopped("synthetic-command-failed", completed=completed)):
                with self.assertRaises(m.HostCommandStopped): p.run(["skopeo", "copy", "synthetic-oci", "synthetic-tag"])
            self.assertEqual(p.import_pending, not completed)
            self.assertEqual(saved, [True, False] if completed else [True])
            if not completed:
                with patch.object(p, "run") as action, self.assertRaisesRegex(m.Stopped, "outcome_unknown"):
                    p.cleanup_image()
                action.assert_not_called()

    def test_host_command_nonzero_timeout_and_oserror_do_not_print_diagnostics(self):
        for effect, completed in [(subprocess.CompletedProcess(["synthetic"], 1), True),
                                  (subprocess.CompletedProcess(["synthetic"], -15), False),
                                  (subprocess.TimeoutExpired("synthetic", 1), False),
                                  (OSError("SYNTHETIC_PRIVATE_CANARY"), False)]:
            kwargs = {"side_effect": effect} if isinstance(effect, Exception) else {"return_value": effect}
            with self.subTest(completed=completed, effect=type(effect).__name__), patch.object(m.subprocess, "run", **kwargs):
                with self.assertRaises(m.HostCommandStopped) as caught: m.command(["synthetic"], {})
                self.assertEqual(caught.exception.completed, completed)
                self.assertNotIn("SYNTHETIC_PRIVATE_CANARY", str(caught.exception))

    def test_signalled_download_is_not_a_known_completed_import(self):
        def interrupted(args, **kwargs):
            kwargs["stdout"].write(b"synthetic partial artifact")
            return subprocess.CompletedProcess(args, -15)
        with patch.object(m.subprocess, "run", side_effect=interrupted):
            with self.assertRaises(m.HostCommandStopped) as caught:
                m.command(["synthetic-download"], {}, output=self.root / "partial.zip")
        self.assertFalse(caught.exception.completed)

    def test_cleanup_requires_identity_census_and_confirmed_removal(self):
        p = self.bare_coordinator(); p.tag = "synthetic-tag"
        with patch.object(p, "run", return_value=b"") as run:
            self.assertTrue(p.cleanup_image()); self.assertEqual(run.call_count, 1)
        outputs = [b"existing", m.canonical([{"Id": p.manifest["operatorClient"]["imageId"]}]), b"", b""]
        with patch.object(p, "run", side_effect=outputs) as run:
            self.assertTrue(p.cleanup_image()); self.assertEqual(run.call_args_list[2].args[0][:3], ["docker", "image", "rm"])
        with patch.object(p, "run", side_effect=[b"existing", m.canonical([{"Id": "sha256:" + "e" * 64}])]) as run:
            with self.assertRaisesRegex(m.Stopped, "identity_changed"): p.cleanup_image()
            self.assertEqual(run.call_count, 2)
        with patch.object(p, "run", side_effect=[b"existing", outputs[1], b"", b"still-existing"]):
            with self.assertRaisesRegex(m.Stopped, "removal_unconfirmed"): p.cleanup_image()

    def test_unknown_partial_load_and_cleanup_exception_preserve_failure_receipt(self):
        for failure in ["uncertain-load", "probe-cleanup", "image-cleanup"]:
            p = self.bare_coordinator()
            plan = {"operatorClient": p.manifest["operatorClient"]}
            def load(*args, **kwargs):
                if failure == "uncertain-load":
                    p.import_pending = True
                    raise m.HostCommandStopped("SYNTHETIC_PRIVATE_FAILURE", completed=False)
            def qualify():
                if failure == "probe-cleanup": p.probe = SimpleNamespace(cleanup=lambda: (_ for _ in ()).throw(RuntimeError("PRIVATE")))
                raise RuntimeError("SYNTHETIC_PRIVATE_FAILURE")
            with self.subTest(failure=failure), patch.object(m, "fetch_artifacts", return_value=({}, {})), \
                 patch.object(p, "check_plan", return_value=SimpleNamespace(value=lambda: plan)), \
                 patch.object(m, "load_exact_operator", side_effect=load), patch.object(p, "qualify", side_effect=qualify):
                if failure == "image-cleanup":
                    with patch.object(p, "cleanup_image", side_effect=RuntimeError("PRIVATE")): result = p.execute()
                else: result = p.execute()
            self.assertFalse(result["restoreVerified"]); self.assertFalse(result["cleanupConfirmed"])
            self.assertEqual(result["cleanupErrorCode"], "owned_cleanup_unconfirmed")
            self.assertEqual(result["errorCode"], "reviewed_private_recovery_unqualified")
            self.assertEqual(result["failedStage"], "operator-identity" if failure == "uncertain-load" else "fresh-native-qualification")
            self.assertNotIn("SYNTHETIC_PRIVATE_FAILURE", p.output.read_text())
            self.assertNotIn('"PRIVATE"', p.output.read_text())
            self.assertEqual(p.output.stat().st_mode & 0o777, 0o600)
            p.output.unlink()
            if p.state_path.exists(): p.state_path.unlink()

    def test_target_bindings_contain_only_fresh_private_target_and_no_source_url(self):
        plan = {"capture": {"ciphertextSha256": "a" * 64, "sourceSha": SOURCE}}
        attestation = {"host": "synthetic-recipient.internal", "serverIp": "172.30.240.2", "systemIdentifier": "12345"}
        bindings = m.target_bindings(plan, attestation, "c" * 64)
        self.assertEqual(bindings["APPROVED_ISOLATED_HOST"], attestation["host"])
        self.assertIn("sslmode=verify-full", bindings["APPROVED_ISOLATED_PG17_DATABASE_URL"])
        self.assertIn("synthetic-recipient.internal:5432/postgres", bindings["APPROVED_ISOLATED_PG17_DATABASE_URL"])
        self.assertNotIn("KOVA_PRODUCTION_DATABASE_URL", bindings)
        self.assertNotIn("KOVA_PRODUCTION_BACKUP_PASSPHRASE", bindings)
        self.assertEqual(bindings["PGPASSFILE"], "/run/client/pgpass")

    def qualified_import_fixture(self, name):
        p = self.bare_coordinator()
        phrase = "SYNTHETIC_PHRASE_CANARY_" * 3
        p.env["KOVA_PRODUCTION_BACKUP_PASSPHRASE"] = phrase
        directory = self.root / name; directory.mkdir()
        client = directory / "client"; client.mkdir()
        capture = directory / "capture"; capture.mkdir()
        ciphertext = private(capture / "managed-auth-backup.tar.gpg", b"synthetic encrypted fixture")
        plan = {"capture": {"ciphertextSha256": m.builder.file_sha(ciphertext), "ciphertextBytes": ciphertext.stat().st_size,
                            "sourceSha": SOURCE}, "sourceCanonicalSemanticsSha256": "e" * 64}
        attestation = {"host": "synthetic-recipient.internal", "serverIp": "172.30.240.2", "systemIdentifier": "12345",
                       "observedAt": datetime.now(timezone.utc).isoformat(),
                       "actualImageRepoDigest": m.review.SERVER_IMAGE, "serverImageTransportSha256": "f" * 64}
        expected = {"operation": "managed-auth-isolated-restore", "restoredDatabaseStateVerified": True,
                    "tablesSequencesLargeObjectsVerified": True, "schemaOwnersPoliciesPrivilegesVerified": True,
                    "extensionSemanticsVerified": True, "extensionSemanticCanonicalSha256": "e" * 64,
                    "actualImageRepoDigest": attestation["actualImageRepoDigest"],
                    "originalApprovedImageRepoDigest": m.review.ORIGINAL_SERVER_IMAGE,
                    "serverImageTransportSha256": attestation["serverImageTransportSha256"]}
        calls = []
        def docker(args, **kwargs):
            calls.append((args, kwargs))
            if "restore-receipt.json" in " ".join(args) and "--execute" not in args:
                return 0, m.canonical(expected)
            return 0, b""
        p.probe = SimpleNamespace(client_dir=client, uid=1234, gid=1234, names={"client": "synthetic-client"},
                                 client_tools={"python3": "/usr/bin/python3"}, docker=docker,
                                 verify_effective_firewalls=unittest.mock.Mock(),
                                 inspect_and_recheck_runtime=unittest.mock.Mock(), consumer_proof=unittest.mock.Mock())
        p.paths = {"capture": capture}
        return p, plan, attestation, expected, calls, phrase, client

    def test_phrase_enters_only_stdin_not_docker_arguments_environment_or_host_files(self):
        p, plan, attestation, expected, calls, phrase, client = self.qualified_import_fixture("valid-import")
        with patch.object(p, "check_plan", return_value=object()):
            self.assertEqual(p.import_qualified(plan, attestation), expected)
        self.assertNotIn("KOVA_PRODUCTION_BACKUP_PASSPHRASE", p.env)
        self.assertEqual(sum(kwargs.get("data") == phrase.encode() for _, kwargs in calls), 1)
        for args, kwargs in calls:
            self.assertNotIn(phrase, json.dumps(args)); self.assertNotIn("--env", args); self.assertNotIn("-e", args)
            self.assertNotIn("env", kwargs)
        for path in client.iterdir(): self.assertNotIn(phrase.encode(), path.read_bytes())
        self.assertFalse((self.root / "phrase").exists())
        bindings = m.strict_json((client / "bindings.json").read_bytes())
        self.assertNotIn("KOVA_PRODUCTION_DATABASE_URL", bindings)
        self.assertNotIn("KOVA_PRODUCTION_BACKUP_PASSPHRASE", bindings)

    def test_restore_receipt_requires_exact_actual_origin_original_provenance_and_transport_hash(self):
        mutations = [
            ("actualImageRepoDigest", m.review.ORIGINAL_SERVER_IMAGE),
            # Same content under a familiar Hub spelling is still not the
            # exact observed spelling bound by this fixture's attestation.
            ("actualImageRepoDigest", "supabase/postgres@" + m.review.CONTENT_DIGEST),
            ("actualImageRepoDigest", m.review.SERVER_IMAGE.replace("supabase/postgres", "foreign/postgres")),
            ("originalApprovedImageRepoDigest", m.review.SERVER_IMAGE),
            ("originalApprovedImageRepoDigest", m.review.ORIGINAL_SERVER_IMAGE[:-1] + "0"),
            ("serverImageTransportSha256", "0" * 64),
            ("serverImageTransportSha256", "F" * 64),
            *[(key, None) for key in ["actualImageRepoDigest", "originalApprovedImageRepoDigest",
                                      "serverImageTransportSha256"]],
        ]
        for index, (key, value) in enumerate(mutations):
            p, plan, attestation, returned, calls, _, _ = self.qualified_import_fixture("bad-import-" + str(index))
            if value is None: returned.pop(key)
            else: returned[key] = value
            with self.subTest(key=key, value=value), patch.object(p, "check_plan", return_value=object()):
                with self.assertRaisesRegex(m.Stopped, "actual_restore_receipt_unqualified"):
                    p.import_qualified(plan, attestation)
            self.assertTrue(any("--execute" in args for args, _ in calls))
            # These are only pre-execution checks. An invalid returned receipt
            # must not reach the final acceptance/requalification pass.
            p.probe.verify_effective_firewalls.assert_called_once_with()
            self.assertEqual(p.probe.inspect_and_recheck_runtime.call_args_list,
                             [unittest.mock.call("client"), unittest.mock.call("a"), unittest.mock.call("b")])
            self.assertEqual(p.probe.consumer_proof.call_args_list,
                             [unittest.mock.call("a"), unittest.mock.call("b")])

    def test_stale_qualification_does_not_release_phrase(self):
        p = self.bare_coordinator(); phrase = "SYNTHETIC_PHRASE_CANARY_" * 3
        p.env["KOVA_PRODUCTION_BACKUP_PASSPHRASE"] = phrase
        client = self.root / "client"; client.mkdir(); capture = self.root / "capture"; capture.mkdir()
        ciphertext = private(capture / "managed-auth-backup.tar.gpg", b"synthetic ciphertext")
        plan = {"capture": {"ciphertextSha256": m.builder.file_sha(ciphertext), "ciphertextBytes": ciphertext.stat().st_size,
                            "sourceSha": SOURCE}}
        attestation = {"host": "synthetic.internal", "serverIp": "172.30.240.2", "systemIdentifier": "12345",
                       "observedAt": (datetime.now(timezone.utc) - timedelta(seconds=901)).isoformat()}
        p.probe = SimpleNamespace(client_dir=client, verify_effective_firewalls=lambda: None,
                                 inspect_and_recheck_runtime=lambda key: None, consumer_proof=lambda key: None,
                                 docker=unittest.mock.Mock())
        p.paths = {"capture": capture}
        with patch.object(p, "check_plan", return_value=object()), self.assertRaisesRegex(m.Stopped, "stale"):
            p.import_qualified(plan, attestation)
        p.probe.docker.assert_not_called()
        self.assertEqual(p.env["KOVA_PRODUCTION_BACKUP_PASSPHRASE"], phrase)


if __name__ == "__main__": unittest.main()
