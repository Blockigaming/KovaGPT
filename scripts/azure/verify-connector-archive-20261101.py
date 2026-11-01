#!/usr/bin/env python3
"""Verify/import the immutable GitHub layer as data. No Azure or runtime writes."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import tarfile
import zipfile

ROOT = Path('/tmp/kova-connectors-github-20261101')
ZIP = Path('/home/zachary/KovaGPT-connector-3e3578e2-verified.zip')
ZIP_SHA = '0b75fb4b68fc03adf3de8c8f5dba1b5ee921ab9e2670e3dea104dfb136221afb'
SOURCE = '3e3578e2d54dff644409adb138211181a15b6a85'
TREE = '697c0b73189f9f1e6afc797d8d802d5db600ae72'
WORKFLOW_COMMIT = '913bd4f90e642bf43649f8c482a149b2d83cee52'
WORKFLOW_SHA = '9c4e8c271768a3c2520f83a837997b8684b84644ee67d17f51e6d0088f59e19a'
BUILDER_SHA = '8c50ce3e0586a2b20af44d2c5618f5decd7677083b0064913fccd7d52b8a4db2'
BUILDER_IMAGE = 'node:24-bookworm-slim@sha256:a43f7fc3e52e87d12a905f46eea0275def84ca8f2981a5b53fed44d7fb398ee0'
BASE_DIGEST = 'sha256:be154aca7c5c02bcbb15c9bc51a73155b36fa04dcce6bbdac8842f2be8982604'
LAYER_SHA = 'ad0537dcc18a5974e5a1b4be54355c2881cf8e82a7663d465ce166260f67a12c'
PROVENANCE_SHA = 'a58d0c7cdbbbd9bb72705074232f1ac8b14bca2c0f0feea6a293c4ba26eca563'
RUN_ID = 41264520697
ARTIFACT_ID = 13066053184


def need(ok, code):
    if not ok:
        raise RuntimeError('connector_archive_' + code)


def hash_stream(file):
    value = hashlib.sha256()
    for block in iter(lambda: file.read(1024 * 1024), b''):
        value.update(block)
    return value.hexdigest()


def sha(path):
    with path.open('rb') as file:
        return hash_stream(file)


def write_once(path, data):
    if path.exists():
        need(path.is_file() and not path.is_symlink() and path.read_bytes() == data, 'existing_file_changed')
        return
    with path.open('xb') as file:
        os.chmod(path, 0o600)
        file.write(data)
        file.flush()
        os.fsync(file.fileno())


def validate_layer(path, rows):
    expected = {}
    for row in rows:
        need(isinstance(row, dict) and set(row) == {'path', 'size', 'sha256'}
             and row['path'] not in expected and isinstance(row['size'], int)
             and 0 <= row['size'] <= 256 * 1024 * 1024, 'file_manifest')
        expected[row['path']] = row
    seen, files, opaque = set(), set(), 0
    with tarfile.open(path) as layer:
        for member in layer:
            name = member.name
            parts = PurePosixPath(name)
            need(not parts.is_absolute() and '..' not in parts.parts and name == posixpath.normpath(name) and name.startswith('app/dist/')
                 and name not in seen, 'layer_path')
            seen.add(name)
            need(len(seen) <= 10000 and member.uid == member.gid == 10001
                 and member.mode & 0o7000 == 0, 'layer_owner_or_mode')
            if name == 'app/dist/.wh..wh..opq':
                need(member.isfile() and member.size == 0, 'opaque_marker')
                opaque += 1
                continue
            need(not any(part.startswith('.wh.') for part in parts.parts), 'extra_whiteout')
            if member.isfile():
                need(not name.endswith('.map') and name in expected
                     and member.size == expected[name]['size'], 'file_inventory')
                need(hash_stream(layer.extractfile(member)) == expected[name]['sha256'], 'file_bytes')
                files.add(name)
            elif member.issym():
                target = posixpath.normpath(posixpath.join(posixpath.dirname(name), member.linkname))
                need(not member.linkname.startswith('/') and target.startswith('app/dist/'), 'external_link')
            elif member.islnk():
                target = posixpath.normpath(member.linkname)
                need(target.startswith('app/dist/') and target in files and name in expected
                     and expected[target]['size'] == expected[name]['size']
                     and expected[target]['sha256'] == expected[name]['sha256'], 'external_hardlink')
                files.add(name)
            else:
                need(member.isdir(), 'special_file')
    need(opaque == 1 and files == set(expected), 'complete_inventory')
    return len(files)


def main():
    os.umask(0o077)
    need(ZIP.is_file() and not ZIP.is_symlink() and ZIP.stat().st_size == 12941882
         and sha(ZIP) == ZIP_SHA, 'github_zip_digest')
    os.chmod(ZIP, 0o600)
    if not ROOT.exists():
        ROOT.mkdir(mode=0o700)
    need(ROOT.is_dir() and not ROOT.is_symlink() and ROOT.stat().st_mode & 0o077 == 0, 'private_root')
    raw = ROOT / 'imported'
    raw.mkdir(mode=0o700, exist_ok=True)
    names = {'application-layer.tar', 'browser-config-provenance.json',
             'build-receipt.json', 'source-attestation.json'}
    with zipfile.ZipFile(ZIP) as archive:
        need(len(archive.infolist()) == 4 and {member.filename for member in archive.infolist()} == names
             and all(not member.is_dir() and member.file_size <= 64 * 1024 * 1024
                     for member in archive.infolist()), 'zip_inventory')
        for name in names:
            write_once(raw / name, archive.read(name))
    receipt = json.loads((raw / 'build-receipt.json').read_bytes())
    fixed = {'schemaVersion': 1, 'sourceSha': SOURCE, 'sourceTree': TREE,
             'sourceContext': 'git-archive', 'buildMethod': 'git-archive-github-container',
             'baseImageDigest': BASE_DIGEST, 'builderImage': BUILDER_IMAGE,
             'builderScriptSha256': BUILDER_SHA, 'workflowCommitSha': WORKFLOW_COMMIT,
             'runId': RUN_ID, 'runAttempt': 1,
             'workflowPath': '.github/workflows/connector-archive-zero-acr-20261101.yml',
             'sourceArchiveSha256': '98b9ac334f995a45b4937894f47477997e0cf57c37596ec589f01013ecb607bc',
             'layerSha256': LAYER_SHA, 'browserProvenanceSha256': PROVENANCE_SHA,
             'paidAcrTaskBuilds': 0, 'azureCredentialsUsed': False, 'productionWrites': 0,
             'allOriginalBuildStagesPreserved': True}
    need(all(type(receipt[k]) is type(value) and receipt[k] == value for k, value in fixed.items()), 'build_receipt')
    layer = raw / 'application-layer.tar'
    provenance = raw / 'browser-config-provenance.json'
    need(sha(layer) == LAYER_SHA and sha(provenance) == PROVENANCE_SHA, 'payload_digest')
    count = validate_layer(layer, receipt['files'])
    attestation = json.loads((raw / 'source-attestation.json').read_bytes())
    need(attestation == {'schemaVersion': 1, 'context': 'git-archive', 'sourceSha': SOURCE, 'sourceTree': TREE}, 'source_attestation')
    p = json.loads(provenance.read_bytes())
    need(p['sourceSha'] == SOURCE and p['sourceTree'] == TREE and p['sourceContext'] == 'git-archive'
         and p['authMode'] == 'dual' and p['supabaseProjectRef'] == 'mfbycmbjygcfkrsuepxf'
         and p['supabaseUrl'] == 'https://mfbycmbjygcfkrsuepxf.supabase.co'
         and p['publishableKeySha256'] == 'e4145db8f59583533f00480a60ba89faed93981242dc7f48ac7790bb9eb86ec7'
         and p['stripePublishableKeySha256'] == '8e55a05729ae811369cf9b4b33d313a58b2e0b774ec6c1449d88f38104267fd8', 'browser_config')
    prior = json.loads(Path('/tmp/kova-google520-release-20261031/google520-build/browser-config-provenance.json').read_bytes())
    need(all(p[k] == prior[k] for k in ['authMode', 'supabaseProjectRef', 'supabaseUrl',
                                      'publishableKeySha256', 'stripePublishableKeySha256']), 'prior_public_config')
    report = {**fixed, 'artifactId': ARTIFACT_ID, 'artifactZipSha256': ZIP_SHA,
              'workflowSha256': WORKFLOW_SHA, 'importVerifierSha256': sha(Path(__file__)),
              'compiledFilesVerified': count, 'everyFileByteAndOwnerVerified': True,
              'opaqueReplacementVerified': True, 'publicInputsMatchPriorVerifiedHashes': True,
              'layerPath': str(layer), 'rawBuildReceiptPath': str(raw / 'build-receipt.json'),
              'registryImagePublished': False, 'runtimeMutationAuthority': False}
    write_once(ROOT / 'artifact-verified.json', json.dumps(report, sort_keys=True, separators=(',', ':')).encode())
    print(json.dumps(report, separators=(',', ':')))


if __name__ == '__main__':
    main()
