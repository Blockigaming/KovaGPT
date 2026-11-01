#!/usr/bin/env python3
"""Build only the exact approved app archive; no Azure credentials or writes."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import subprocess
import tarfile

SOURCE = '3e3578e2d54dff644409adb138211181a15b6a85'
TREE = '697c0b73189f9f1e6afc797d8d802d5db600ae72'
BASE_SOURCE = '5448421cef437365530244ca56d387ff8d4da0ba'
BASE_DIGEST = 'sha256:be154aca7c5c02bcbb15c9bc51a73155b36fa04dcce6bbdac8842f2be8982604'
HEADS = ['fce34083d020844d293f1bb0d17bc3f5f49b9bbd',
         '084e68e774a49ee26ef6516131989937beeb0c36',
         'afae2ec7ce61910d34e8e3465de04ff44bd3cd74',
         '982fb95ebd6287c869525b0cba0cc401248383dc',
         '73cd2f47634b727bbc2e628e1477ff2abf745581']
BUILDER_IMAGE = 'node:24-bookworm-slim@sha256:a43f7fc3e52e87d12a905f46eea0275def84ca8f2981a5b53fed44d7fb398ee0'
ALLOWED = {
    'src/lib/ai/free-connector-budget.server.ts', 'src/routes/api/chat.ts',
    'tests/integration/workflow-skills-source.test.mjs',
    'tests/unit/free-connector-budget-runtime.test.mjs', 'tests/unit/free-connector-budget.test.mjs',
    'src/components/ComposerPluginList.tsx', 'src/lib/composer-plugin-usage.d.mts',
    'src/lib/composer-plugin-usage.mjs', 'src/lib/github.functions.ts',
    'tests/unit/composer-draft-context.test.mjs', 'tests/unit/github-management-failures.test.mjs',
    'tests/e2e/ui-quality.spec.ts', 'tests/unit/generative-ui-integration.test.mjs',
    'src/components/auth/AuthDialog.tsx', 'src/routes/index.tsx', 'src/routes/~oauth.callback.tsx',
    'tests/e2e/auth-visual-regression.spec.ts-snapshots/guest-auth-dialog-desktop-1440x900-linux.png',
    'tests/e2e/auth-visual-regression.spec.ts-snapshots/guest-auth-dialog-phone-390x844-linux.png',
    'tests/unit/kova-auth-dual-hosted-google-start.test.mjs',
    'tests/unit/kova-auth-passkey-ui.test.mjs', 'tests/unit/oauth-callback-effect-replay.test.mjs',
}


def need(ok, code):
    if not ok:
        raise RuntimeError('connector_archive_' + code)


def sha(path):
    value = hashlib.sha256()
    with path.open('rb') as file:
        for block in iter(lambda: file.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def run(args, cwd, capture=False, timeout=1200):
    result = subprocess.run(args, cwd=cwd, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE if capture else None, check=True, timeout=timeout)
    return result.stdout.decode().strip() if capture else None


def write(path, value):
    with path.open('x') as file:
        json.dump(value, file, sort_keys=True, separators=(',', ':'))


def main():
    os.umask(0o077)
    need(os.environ['GITHUB_REPOSITORY'] == 'Blockigaming/KovaGPT', 'repository')
    need(os.environ['GITHUB_EVENT_NAME'] == 'push' and
         os.environ['GITHUB_REF'] == 'refs/heads/ops/connector-archive-zero-acr-20261101', 'trigger')
    need(os.environ['GITHUB_RUN_ATTEMPT'] == '1', 'attempt')
    need(os.environ['KOVA_BUILDER_IMAGE'] == BUILDER_IMAGE, 'builder_image')
    need(sha(Path(__file__)) == os.environ['KOVA_EXPECTED_BUILDER_SHA256'], 'builder_source')
    repo = Path(os.environ['GITHUB_WORKSPACE']) / 'source'
    need(run(['git', 'rev-parse', 'HEAD'], repo, True) == SOURCE, 'source_head')
    need(run(['git', 'rev-parse', 'HEAD^{tree}'], repo, True) == TREE, 'source_tree')
    need(not run(['git', 'status', '--porcelain'], repo, True), 'source_dirty')
    need(run(['git', 'ls-remote', 'https://github.com/Blockigaming/KovaGPT.git', 'refs/heads/main'], repo, True)
         == SOURCE + '\trefs/heads/main', 'main_moved')
    for head in [BASE_SOURCE] + HEADS:
        run(['git', 'merge-base', '--is-ancestor', head, SOURCE], repo)
    changed = set(run(['git', 'diff', '--name-only', BASE_SOURCE, SOURCE], repo, True).splitlines())
    need(changed <= ALLOWED, 'unreviewed_paths')
    for path in ['Dockerfile', 'package.json', 'package-lock.json']:
        need(run(['git', 'rev-parse', BASE_SOURCE + ':' + path], repo, True) ==
             run(['git', 'rev-parse', SOURCE + ':' + path], repo, True), 'runtime_dependency_changed')
    key = os.environ['VITE_SUPABASE_PUBLISHABLE_KEY']
    stripe = os.environ['VITE_PAYMENTS_CLIENT_TOKEN']
    need(hashlib.sha256(key.encode()).hexdigest() == os.environ['KOVA_EXPECTED_PUBLIC_KEY_SHA256'] and
         hashlib.sha256(stripe.encode()).hexdigest() == os.environ['KOVA_EXPECTED_STRIPE_KEY_SHA256'], 'public_input_hashes')
    need(os.environ['VITE_SUPABASE_URL'] == 'https://' + os.environ['KOVA_EXPECTED_SUPABASE_PROJECT_REF'] + '.supabase.co', 'public_url')
    build = Path('/tmp/kova-connector-archive')
    output = Path('/tmp/kova-connector-output')
    build.mkdir(mode=0o700)
    output.mkdir(mode=0o700)
    source_archive = Path('/tmp/kova-connector-source.tar')
    run(['git', 'archive', '--format=tar', '--output=' + str(source_archive), SOURCE], repo)
    with tarfile.open(source_archive) as archive:
        for member in archive:
            path = PurePosixPath(member.name)
            need(not path.is_absolute() and '..' not in path.parts and
                 (member.isfile() or member.isdir() or member.issym()), 'archive_path')
            if member.issym():
                target = posixpath.normpath(posixpath.join(posixpath.dirname(member.name), member.linkname))
                need(not member.linkname.startswith('/') and not target.startswith('../'), 'archive_link')
        archive.extractall(build)
    attestation = {'schemaVersion': 1, 'context': 'git-archive', 'sourceSha': SOURCE, 'sourceTree': TREE}
    write(build / '.kova-source-attestation.json', attestation)
    install_env = dict(os.environ, NODE_ENV='development')
    subprocess.run(['npm', 'ci', '--no-audit', '--no-fund'], cwd=build, env=install_env, check=True, timeout=600)
    subprocess.run(['npm', 'run', 'build'], cwd=build, env=dict(os.environ, NODE_ENV='production'), check=True, timeout=1200)
    dist = build / 'dist'
    for path in dist.rglob('*.map'):
        path.unlink()
    verify_env = dict(os.environ, NODE_ENV='production',
                      KOVA_BROWSER_BUNDLE_DIR='dist/client',
                      KOVA_BROWSER_CONFIG_PROVENANCE_PATH='dist/browser-config-provenance.json',
                      KOVA_SOURCE_SHA=SOURCE, KOVA_SOURCE_TREE=TREE,
                      KOVA_SOURCE_ATTESTATION_PATH=str(build / '.kova-source-attestation.json'))
    subprocess.run(['node', 'scripts/azure/verify-browser-config.mjs'], cwd=build, env=verify_env, check=True, timeout=180)
    provenance_path = dist / 'browser-config-provenance.json'
    provenance = json.loads(provenance_path.read_bytes())
    need(provenance['sourceSha'] == SOURCE and provenance['sourceTree'] == TREE and
         provenance['sourceContext'] == 'git-archive' and provenance['authMode'] == 'dual' and
         provenance['publishableKeySha256'] == os.environ['KOVA_EXPECTED_PUBLIC_KEY_SHA256'] and
         provenance['stripePublishableKeySha256'] == os.environ['KOVA_EXPECTED_STRIPE_KEY_SHA256'], 'provenance')
    rows = []
    layer_path = output / 'application-layer.tar'
    with tarfile.open(layer_path, 'x') as layer:
        opaque = tarfile.TarInfo('app/dist/.wh..wh..opq')
        opaque.uid = opaque.gid = 10001
        opaque.mode = 0o644
        layer.addfile(opaque)
        for path in sorted(dist.rglob('*')):
            need(path.resolve().is_relative_to(dist.resolve()), 'external_bundle_link')
            name = 'app/dist/' + path.relative_to(dist).as_posix()
            info = layer.gettarinfo(str(path), arcname=name)
            info.uid = info.gid = 10001
            info.uname = info.gname = 'kova'
            need(info.mode & 0o7000 == 0, 'unsafe_bundle_mode')
            if path.is_file() and not path.is_symlink():
                rows.append({'path': name, 'sha256': sha(path), 'size': path.stat().st_size})
                with path.open('rb') as file:
                    layer.addfile(info, file)
            else:
                layer.addfile(info)
    receipt = {'schemaVersion': 1, 'sourceSha': SOURCE, 'sourceTree': TREE,
               'sourceContext': 'git-archive', 'buildMethod': 'git-archive-github-container',
               'baseImageDigest': BASE_DIGEST, 'sourceArchiveSha256': sha(source_archive),
               'builderImage': BUILDER_IMAGE, 'builderScriptSha256': sha(Path(__file__)),
               'workflowCommitSha': os.environ['GITHUB_SHA'], 'runId': int(os.environ['GITHUB_RUN_ID']),
               'runAttempt': 1, 'workflowPath': '.github/workflows/connector-archive-zero-acr-20261101.yml',
               'layerSha256': sha(layer_path), 'browserProvenanceSha256': sha(provenance_path),
               'files': rows, 'paidAcrTaskBuilds': 0, 'azureCredentialsUsed': False,
               'productionWrites': 0, 'allOriginalBuildStagesPreserved': True,
               'nodeVersion': run(['node', '--version'], build, True)}
    write(output / 'build-receipt.json', receipt)
    (output / 'browser-config-provenance.json').write_bytes(provenance_path.read_bytes())
    write(output / 'source-attestation.json', attestation)
    print(json.dumps({key: value for key, value in receipt.items() if key != 'files'}))


if __name__ == '__main__':
    main()
