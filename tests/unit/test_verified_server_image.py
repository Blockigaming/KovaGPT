"""Synthetic standard-Engine contract checks: no registry, Docker or network."""
import copy
from contextlib import contextmanager
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/release/verified-server-image.py"
spec = importlib.util.spec_from_file_location("verified_server_test_module", SCRIPT)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def fixture():
    manifest = {"schemaVersion": 2, "mediaType": "application/vnd.oci.image.manifest.v1+json",
                "config": {"mediaType": "application/vnd.oci.image.config.v1+json", "digest": "sha256:" + "d" * 64, "size": 345},
                "layers": [{"mediaType": "application/vnd.oci.image.layer.v1.tar+gzip", "digest": "sha256:" + value * 64, "size": 100}
                           for value in ["e", "f"]]}
    image = {"os": "linux", "architecture": "amd64", "config": {"Env": ["SYNTHETIC_PRIVATE_CONFIG_CANARY"]},
             "rootfs": {"type": "layers", "diff_ids": ["sha256:" + value * 64 for value in ["1", "2"]]}}
    return manifest, image


class Commands:
    def __init__(self, manifest, image):
        self.raw = m.canonical(manifest)
        self.image = m.canonical(image)
        self.pin = "sha256:" + hashlib.sha256(self.raw).hexdigest()
        self.ref = "docker.io/supabase/postgres@" + self.pin
        self.original = "public.ecr.aws/supabase/postgres@" + self.pin
        self.actual = [{"Id": manifest["config"]["digest"], "Os": "linux", "Architecture": "amd64",
                        "RepoDigests": [self.ref], "RootFS": {"Type": "layers", "Layers": image["rootfs"]["diff_ids"]},
                        "Config": {"Env": ["SYNTHETIC_PRIVATE_DAEMON_CANARY"]}}]
        self.version = b"github.com/docker/buildx v0.30.1 synthetic\n"
        self.calls = []; self.tuple_result = False; self.pull_error = None

    def __call__(self, args, **kwargs):
        self.calls.append((copy.deepcopy(args), kwargs))
        if args == ["docker", "buildx", "version"]: raw = self.version
        elif args == ["docker", "buildx", "imagetools", "inspect", "--raw", self.ref]: raw = self.raw
        elif args == ["docker", "buildx", "imagetools", "inspect", "--format", "{{json .Image}}", self.ref]: raw = self.image
        elif args == ["docker", "pull", "--platform", "linux/amd64", self.ref]:
            if self.pull_error is not None: raise self.pull_error
            raw = b"synthetic standard Engine pull complete\n"
        elif args == ["docker", "image", "inspect", self.ref]: raw = m.canonical(self.actual)
        else: raise AssertionError("unexpected synthetic command")
        return (0, raw) if self.tuple_result else raw


@contextmanager
def synthetic_pin(manifest=None, image=None):
    default_manifest, default_image = fixture()
    manifest = copy.deepcopy(default_manifest if manifest is None else manifest)
    image = copy.deepcopy(default_image if image is None else image)
    # Fake inspected objects are independent of malformed semantic-config cases.
    command = Commands(default_manifest, default_image)
    command.raw = m.canonical(manifest); command.image = m.canonical(image)
    command.pin = "sha256:" + hashlib.sha256(command.raw).hexdigest()
    command.ref = "docker.io/supabase/postgres@" + command.pin
    command.original = "public.ecr.aws/supabase/postgres@" + command.pin
    command.actual[0]["RepoDigests"] = [command.ref]
    with patch.multiple(m, CONTENT_DIGEST=command.pin, TRANSPORT_REF=command.ref, ORIGINAL_ECR_REF=command.original):
        yield command


class VerifiedServerTests(unittest.TestCase):
    def test_public_constants_keep_exact_original_content_digest(self):
        pin = "sha256:3e2a7ab48783077d0122dc72ed5174afb543110c38266c845716c51d130658e4"
        self.assertEqual(m.CONTENT_DIGEST, pin)
        self.assertEqual(m.ORIGINAL_ECR_REF, "public.ecr.aws/supabase/postgres@" + pin)
        self.assertEqual(m.TRANSPORT_REF, "docker.io/supabase/postgres@" + pin)

    def test_exact_five_commands_return_private_info_and_narrow_honest_receipt(self):
        with synthetic_pin() as command:
            result = m.qualify(command)
            self.assertEqual(result["imageInfo"], command.actual[0])
            receipt = result["receipt"]
            self.assertEqual(receipt["contentDigest"], command.pin)
            self.assertEqual(receipt["manifestSha256"], command.pin.split(":")[1])
            self.assertEqual(receipt["manifestDescriptorCount"], 3)
            self.assertEqual(receipt["compressedLayerCount"], 2)
            self.assertEqual(receipt["imageId"], "sha256:" + "d" * 64)
            self.assertEqual(receipt["actualRepoDigest"], command.ref)
            self.assertEqual(receipt["engineVerificationContract"], "docker-engine-digest-pinned-pull")
            self.assertIs(receipt["manualLayerHashingPerformed"], False)
            self.assertNotIn("SYNTHETIC_PRIVATE", json.dumps(receipt))
            self.assertEqual([c[0] for c in command.calls], [
                ["docker", "buildx", "version"],
                ["docker", "buildx", "imagetools", "inspect", "--raw", command.ref],
                ["docker", "buildx", "imagetools", "inspect", "--format", "{{json .Image}}", command.ref],
                ["docker", "pull", "--platform", "linux/amd64", command.ref],
                ["docker", "image", "inspect", command.ref]])
            self.assertTrue(all(set(kwargs) == {"timeout"} for _, kwargs in command.calls))

    def test_probe_tuple_callback_and_exact_docker_familiar_repo_spelling_are_supported(self):
        with synthetic_pin() as command:
            command.tuple_result = True
            command.actual[0]["RepoDigests"] = ["supabase/postgres@" + command.pin]
            receipt = m.qualify(command)["receipt"]
            self.assertEqual(receipt["actualRepoDigest"], "supabase/postgres@" + command.pin)

    def test_raw_manifest_is_hashed_without_strip_newline_or_reserialization(self):
        for change in [lambda raw: raw + b"\n", lambda raw: raw.rstrip(b"\n"),
                       lambda raw: json.dumps(json.loads(raw), indent=2).encode(), lambda raw: raw + b" "]:
            with synthetic_pin() as command:
                command.raw = change(command.raw)
                with self.subTest(change=change), self.assertRaisesRegex(m.Stopped, "manifest_digest_mismatch"):
                    m.qualify(command)
                self.assertEqual(len(command.calls), 2)

    def test_duplicate_json_and_nonfinite_constants_are_rejected(self):
        for raw in [b'{"schemaVersion":2,"schemaVersion":2}', b'{"unused":NaN}',
                    b'{"outer":{"same":1,"same":2}}', b'{"unused":Infinity}']:
            with self.subTest(raw=raw), self.assertRaises(m.Stopped): m.strict_json(raw)
        with synthetic_pin() as command:
            command.image = b'{"os":"linux","os":"linux"}'
            with self.assertRaisesRegex(m.Stopped, "duplicate_json_key"): m.qualify(command)
            self.assertEqual(len(command.calls), 3)

    def test_manifest_must_be_schema_two_single_platform_not_tag_or_index(self):
        for key, value in [("schemaVersion", True), ("schemaVersion", 2.0), ("schemaVersion", 1),
                           ("mediaType", "application/vnd.oci.image.index.v1+json"), ("mediaType", []), ("manifests", []),
                           ("layers", []), ("layers", {})]:
            manifest, image = fixture(); manifest[key] = value
            with self.subTest(key=key, value=value), synthetic_pin(manifest, image) as command:
                with self.assertRaisesRegex(m.Stopped, "platform_manifest_required"): m.qualify(command)
                self.assertEqual(len(command.calls), 2)

    def test_descriptor_digest_media_size_and_external_url_rejections_precede_pull(self):
        for target in ["config", "layer"]:
            for key, value in [("digest", "sha256:" + "F" * 64), ("digest", "other:abc"), ("size", True),
                               ("size", 0), ("size", -1), ("size", m.MAX_LAYER_BYTES + 1),
                               ("mediaType", "unreviewed/type"), ("mediaType", {}), ("urls", ["https://unreviewed.invalid/blob"])]:
                manifest, image = fixture()
                (manifest["config"] if target == "config" else manifest["layers"][0])[key] = value
                with self.subTest(target=target, key=key, value=value), synthetic_pin(manifest, image) as command:
                    with self.assertRaisesRegex(m.Stopped, "descriptor_unqualified"): m.qualify(command)
                    self.assertEqual(len(command.calls), 2)

    def test_layer_count_and_total_compressed_size_are_bounded(self):
        manifest, image = fixture(); manifest["layers"] *= m.MAX_LAYERS
        with synthetic_pin(manifest, image) as command:
            with self.assertRaisesRegex(m.Stopped, "platform_manifest_required"): m.qualify(command)
        manifest, image = fixture(); manifest["layers"] *= 2
        for row in manifest["layers"]: row["size"] = m.MAX_LAYER_BYTES
        with synthetic_pin(manifest, image) as command:
            with self.assertRaisesRegex(m.Stopped, "layer_total_bound"): m.qualify(command)

    def test_formatted_config_is_semantic_single_image_os_arch_and_ordered_diffids_only(self):
        for mutation in [lambda image: image.update(os="windows"), lambda image: image.update(architecture="arm64"),
                         lambda image: image.update(rootfs={"type": "other", "diff_ids": []}),
                         lambda image: image["rootfs"].update(diff_ids=["sha256:" + "1" * 64]),
                         lambda image: image["rootfs"].update(diff_ids=["not-digest"] * 2)]:
            manifest, image = fixture(); mutation(image)
            with self.subTest(mutation=mutation), synthetic_pin(manifest, image) as command:
                with self.assertRaisesRegex(m.Stopped, "config_semantics_unqualified"): m.qualify(command)
                self.assertEqual(len(command.calls), 3)
        with synthetic_pin(image={"linux/amd64": fixture()[1]}) as command:
            with self.assertRaisesRegex(m.Stopped, "config_semantics_unqualified"): m.qualify(command)

    def test_daemon_identity_and_ordered_uncompressed_layers_must_match_before_receipt(self):
        for key, value in [("Id", "sha256:" + "0" * 64), ("Os", "windows"), ("Architecture", "arm64"),
                           ("RepoDigests", []), ("RepoDigests", ["foreign/supabase/postgres@" + m.CONTENT_DIGEST]),
                           ("RootFS", {"Type": "layers", "Layers": ["sha256:" + "2" * 64, "sha256:" + "1" * 64]}),
                           ("RootFS", {"Type": "other", "Layers": []})]:
            with synthetic_pin() as command:
                command.actual[0][key] = value
                with self.subTest(key=key, value=value), self.assertRaisesRegex(m.Stopped, "daemon_identity_unqualified"):
                    m.qualify(command)
                self.assertEqual(len(command.calls), 5)

    def test_other_registry_or_tag_spelling_is_not_a_repo_digest_alias(self):
        with synthetic_pin() as command:
            for reference in [command.original, "supabase/postgres:17.6.1.155", "mirror.invalid/supabase/postgres@" + command.pin,
                              "docker.io/foreign/postgres@" + command.pin, "supabase/postgres@sha256:" + "0" * 64]:
                command.actual[0]["RepoDigests"] = [reference]
                with self.subTest(reference=reference), self.assertRaises(m.Stopped): m.qualify(command)

    def test_formatted_config_hash_is_not_used_as_original_config_digest(self):
        with synthetic_pin() as command:
            self.assertNotEqual("sha256:" + hashlib.sha256(command.image).hexdigest(), command.actual[0]["Id"])
            self.assertEqual(m.qualify(command)["receipt"]["imageId"], command.actual[0]["Id"])

    def test_compressed_manifest_hashes_are_not_confused_with_uncompressed_diffids(self):
        with synthetic_pin() as command:
            self.assertEqual(m.qualify(command)["receipt"]["compressedLayerCount"], 2)
            command.actual[0]["RootFS"]["Layers"] = [row["digest"] for row in json.loads(command.raw)["layers"]]
            with self.assertRaisesRegex(m.Stopped, "daemon_identity_unqualified"): m.qualify(command)

    def test_version_is_bounded_printable_ascii_without_terminal_control_or_extra_lines(self):
        for version in [b"", b"x" * 513, b"buildx\nother\n", b"buildx\x1b[31m\n", b"buildx\xff\n", b"buildx\v"]:
            with synthetic_pin() as command:
                command.version = version
                with self.subTest(version=version), self.assertRaisesRegex(m.Stopped, "buildx_version_unqualified"):
                    m.qualify(command)
                self.assertEqual(len(command.calls), 1)

    def test_native_errors_and_invalid_callback_shapes_never_emit_dynamic_messages(self):
        def fail(*args, **kwargs): raise RuntimeError("SYNTHETIC_PRIVATE_EXCEPTION_CANARY")
        with self.assertRaises(m.Stopped) as caught: m.qualify(fail)
        self.assertNotIn("SYNTHETIC_PRIVATE", str(caught.exception))
        self.assertIn(str(caught.exception), m.PUBLIC_FAILURE_CODES)
        for result in [(True, b"x"), (1, b"x"), (0, "not bytes"), "not bytes", (0, b"x", b"extra")]:
            with self.subTest(result=result), self.assertRaises(m.Stopped): m.qualify(lambda *a, **k: result)
        with synthetic_pin() as command:
            command.pull_error = RuntimeError("SYNTHETIC_PRIVATE_PULL_CANARY")
            with self.assertRaisesRegex(m.Stopped, "command_unconfirmed"): m.qualify(command)
            self.assertEqual(len(command.calls), 4)

    def test_failure_code_export_contains_only_literal_safe_stopped_codes(self):
        import ast
        source = ast.parse(SCRIPT.read_text())
        emitted = {node.args[1].value for node in ast.walk(source) if isinstance(node, ast.Call)
                   and isinstance(node.func, ast.Name) and node.func.id == "require"
                   and len(node.args) == 2 and isinstance(node.args[1], ast.Constant)}
        emitted |= {node.args[0].value for node in ast.walk(source) if isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Name) and node.func.id == "Stopped"
                    and isinstance(node.args[0], ast.Constant)}
        self.assertEqual(m.PUBLIC_FAILURE_CODES, frozenset(emitted))


if __name__ == "__main__": unittest.main()
