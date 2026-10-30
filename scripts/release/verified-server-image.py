#!/usr/bin/env python3
"""Qualify the same pinned server content through its official Hub transport.

Use standard Docker Engine content validation, never a custom registry client.
Raw manifest bytes must match the existing pin. Formatted config JSON is used
only for semantic comparisons: it is not the original config blob. The caller
still qualifies actual server binaries, catalog, isolation and running image ID.
"""
import hashlib
import json
import re

CONTENT_DIGEST = "sha256:3e2a7ab48783077d0122dc72ed5174afb543110c38266c845716c51d130658e4"
ORIGINAL_ECR_REF = "public.ecr.aws/supabase/postgres@" + CONTENT_DIGEST
TRANSPORT_REF = "docker.io/supabase/postgres@" + CONTENT_DIGEST
MAX_JSON_BYTES = 8 * 1024**2
MAX_CONFIG_BYTES = 16 * 1024**2
MAX_LAYER_BYTES = 16 * 1024**3
MAX_TOTAL_LAYER_BYTES = 32 * 1024**3
MAX_LAYERS = 256
MANIFEST_TYPES = {"application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"}
CONFIG_TYPES = {"application/vnd.oci.image.config.v1+json", "application/vnd.docker.container.image.v1+json"}
LAYER_TYPES = {"application/vnd.oci.image.layer.v1.tar", "application/vnd.oci.image.layer.v1.tar+gzip",
               "application/vnd.oci.image.layer.v1.tar+zstd", "application/vnd.docker.image.rootfs.diff.tar",
               "application/vnd.docker.image.rootfs.diff.tar.gzip"}
DIGEST = re.compile(r"sha256:[a-f0-9]{64}\Z")
PUBLIC_FAILURE_CODES = frozenset({
    "server_image_json_bound", "server_image_duplicate_json_key", "server_image_json_unqualified",
    "server_image_command_unconfirmed", "server_image_command_output_unqualified",
    "server_image_descriptor_unqualified", "server_image_command_required",
    "server_image_buildx_version_unqualified", "server_image_manifest_digest_mismatch",
    "server_image_platform_manifest_required", "server_image_layer_total_bound",
    "server_image_config_semantics_unqualified", "server_image_daemon_identity_unqualified",
})


class Stopped(Exception): pass


def require(ok, code):
    if not ok: raise Stopped(code)


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def strict_json(raw):
    require(type(raw) is bytes and 0 < len(raw) <= MAX_JSON_BYTES, "server_image_json_bound")
    def pairs(rows):
        value = {}
        for key, item in rows:
            require(key not in value, "server_image_duplicate_json_key")
            value[key] = item
        return value
    def constant(_): raise Stopped("server_image_json_unqualified")
    try: return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)
    except (ValueError, UnicodeError): raise Stopped("server_image_json_unqualified") from None


def invoke(command, args, *, timeout=120):
    try: raw = command(args, timeout=timeout)
    except Exception: raise Stopped("server_image_command_unconfirmed") from None
    if type(raw) is tuple:
        require(len(raw) == 2 and type(raw[0]) is int and raw[0] == 0, "server_image_command_unconfirmed")
        raw = raw[1]
    require(type(raw) is bytes and len(raw) <= MAX_JSON_BYTES, "server_image_command_output_unqualified")
    return raw


def descriptor(value, media_types, limit):
    require(type(value) is dict and type(value.get("mediaType")) is str and value["mediaType"] in media_types
            and type(value.get("digest")) is str and DIGEST.fullmatch(value["digest"])
            and type(value.get("size")) is int and 0 < value["size"] <= limit
            and "urls" not in value, "server_image_descriptor_unqualified")
    return value


def qualify(command):
    require(callable(command), "server_image_command_required")
    version = invoke(command, ["docker", "buildx", "version"], timeout=30)
    lines = version.splitlines()
    require(len(lines) == 1 and 0 < len(lines[0]) <= 512
            and version in {lines[0], lines[0] + b"\n", lines[0] + b"\r\n"}
            and all(32 <= value <= 126 for value in lines[0]), "server_image_buildx_version_unqualified")
    version = lines[0].decode("ascii")

    raw = invoke(command, ["docker", "buildx", "imagetools", "inspect", "--raw", TRANSPORT_REF])
    manifest_hash = hashlib.sha256(raw).hexdigest()
    # Byte exact: never strip a newline, normalize JSON or substitute a tag.
    require("sha256:" + manifest_hash == CONTENT_DIGEST, "server_image_manifest_digest_mismatch")
    manifest = strict_json(raw)
    require(type(manifest) is dict and type(manifest.get("schemaVersion")) is int
            and manifest["schemaVersion"] == 2 and type(manifest.get("mediaType")) is str
            and manifest["mediaType"] in MANIFEST_TYPES
            and "manifests" not in manifest and type(manifest.get("layers")) is list
            and 0 < len(manifest["layers"]) <= MAX_LAYERS, "server_image_platform_manifest_required")
    config = descriptor(manifest.get("config"), CONFIG_TYPES, MAX_CONFIG_BYTES)
    layers = [descriptor(value, LAYER_TYPES, MAX_LAYER_BYTES) for value in manifest["layers"]]
    require(sum(value["size"] for value in layers) <= MAX_TOTAL_LAYER_BYTES, "server_image_layer_total_bound")

    image = strict_json(invoke(command, ["docker", "buildx", "imagetools", "inspect", "--format", "{{json .Image}}", TRANSPORT_REF]))
    require(type(image) is dict and image.get("os") == "linux" and image.get("architecture") == "amd64"
            and type(image.get("rootfs")) is dict and image["rootfs"].get("type") == "layers"
            and type(image["rootfs"].get("diff_ids")) is list
            and len(image["rootfs"]["diff_ids"]) == len(layers)
            and all(type(value) is str and DIGEST.fullmatch(value) for value in image["rootfs"]["diff_ids"]),
            "server_image_config_semantics_unqualified")

    # Engine validates the digest-pinned manifest/config and downloaded layer
    # bytes, then their uncompressed DiffIDs. This is not manual blob hashing.
    invoke(command, ["docker", "pull", "--platform", "linux/amd64", TRANSPORT_REF], timeout=300)
    rows = strict_json(invoke(command, ["docker", "image", "inspect", TRANSPORT_REF], timeout=60))
    require(type(rows) is list and len(rows) == 1 and type(rows[0]) is dict, "server_image_daemon_identity_unqualified")
    actual = rows[0]
    accepted = {TRANSPORT_REF, "supabase/postgres@" + CONTENT_DIGEST}
    repo_digests = actual.get("RepoDigests")
    require(type(repo_digests) is list and all(type(value) is str for value in repo_digests)
            and any(value in accepted for value in repo_digests)
            and actual.get("Id") == config["digest"] and actual.get("Os") == "linux"
            and actual.get("Architecture") == "amd64" and type(actual.get("RootFS")) is dict
            and actual["RootFS"].get("Type") == "layers"
            and actual["RootFS"].get("Layers") == image["rootfs"]["diff_ids"],
            "server_image_daemon_identity_unqualified")
    semantics = {"os": "linux", "architecture": "amd64", "rootfs": image["rootfs"]}
    receipt = {"operation": "verified-official-server-image-transport",
               "originalEcrReference": ORIGINAL_ECR_REF, "transportReference": TRANSPORT_REF,
               "contentDigest": CONTENT_DIGEST, "manifestSha256": manifest_hash,
               "manifestDescriptorCount": len(layers) + 1, "compressedLayerCount": len(layers),
               "imageId": actual["Id"], "actualRepoDigest": next(value for value in repo_digests if value in accepted),
               "buildxVersion": version, "semanticConfigSha256": hashlib.sha256(canonical(semantics)).hexdigest(),
               "engineVerificationContract": "docker-engine-digest-pinned-pull", "manualLayerHashingPerformed": False}
    return {"imageInfo": actual, "receipt": receipt}
