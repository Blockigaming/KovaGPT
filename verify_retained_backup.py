"""Isolated M18 verification core. No database, restore, upload or secret storage.

Preparation only: secret existence/update metadata and encrypted input pins
are verified. Hosted execution and its temporary protected input entries require
explicit approval. The approved launcher must provide secret stdin, never argv.
This program emits a fixed-field result only, after temporary-file cleanup.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import resource
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import zipfile

ZIP_SHA = 'de65e0334bdfa1a2046c46dc36f52756956da65116386eb255d73d8ecd4bf4eb'
CIPHER_SHA = 'a153ed26ce29f59d800e14b66733846fc1a2e841182d6265ac2fd7322a4ae53f'
SOURCE_SHA = '24106a7c34d05c234f6d1040cc4bb339c26ed0ca'
PROJECT = 'mfbycmbjygcfkrsuepxf'
FILES = frozenset(('roles.sql', 'schema.sql', 'data.sql', 'history_schema.sql', 'history_data.sql'))
LIMIT = 64 * 1024 * 1024
TIMEOUT = 120
FAILURES = frozenset(('INPUT_FILE', 'ZIP_PIN', 'ZIP_MEMBERS', 'CIPHER_PIN', 'RECEIPT',
                     'GPG_EXIT', 'GPG_STATUS', 'GPG_TIMEOUT', 'GPG_LAUNCH', 'MEMBERS',
                     'MANIFEST', 'PAYLOAD', 'CLEANUP', 'INTERRUPTED', 'INTERNAL',
                     'ARGUMENTS', 'ISOLATION'))

class Stop(RuntimeError):
    def __init__(self, code):
        self.code = code if code in FAILURES else 'INTERNAL'
        super().__init__(self.code)

def check(ok, code):
    if not ok:
        raise Stop(code)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def unique_object(pairs):
    result = {}
    for key, value in pairs:
        check(key not in result, 'MANIFEST')
        result[key] = value
    return result

def parse_json(data):
    return json.loads(data, object_pairs_hook=unique_object)

def inspect_zip(raw):
    check(0 < len(raw) <= LIMIT and sha(raw) == ZIP_SHA, 'ZIP_PIN')
    with zipfile.ZipFile(io.BytesIO(raw)) as zipped:
        members = zipped.infolist()
        check(len(members) == 2 and {m.filename for m in members} ==
              {'backup-evidence.json', 'kova-production-backup.tar.gpg'} and
              all(not m.is_dir() and not m.flag_bits & 1 and
                  0 < m.file_size <= LIMIT and
                  not stat.S_ISLNK(m.external_attr >> 16) for m in members), 'ZIP_MEMBERS')
        receipt = parse_json(zipped.read('backup-evidence.json'))
        cipher = zipped.read('kova-production-backup.tar.gpg')
    check(sha(cipher) == CIPHER_SHA, 'CIPHER_PIN')
    check(isinstance(receipt, dict) and receipt.get('schemaVersion') == 1 and
          receipt.get('operation') == 'supabase-production-logical-backup-evidence' and
          receipt.get('projectRef') == PROJECT and receipt.get('sourceSha') == SOURCE_SHA and
          receipt.get('encryptedArchiveSha256') == CIPHER_SHA and
          receipt.get('encryptedArchiveBytes') == len(cipher) and
          receipt.get('plaintextUploaded') is False and
          receipt.get('restoreExercised') is False, 'RECEIPT')
    return cipher

def inspect_plaintext(plain):
    check(0 < len(plain) <= LIMIT, 'MEMBERS')
    with tarfile.open(fileobj=io.BytesIO(plain), mode='r:') as archive:
        members = archive.getmembers()
        check(len(members) == 6 and {m.name for m in members} == FILES | {'manifest.json'} and
              all(m.isfile() and 0 < m.size <= LIMIT for m in members) and
              sum(m.size for m in members) <= LIMIT, 'MEMBERS')
        manifest = parse_json(archive.extractfile('manifest.json').read())
        check(isinstance(manifest, dict) and manifest.get('schemaVersion') == 1 and
              manifest.get('operation') == 'supabase-production-logical-backup' and
              manifest.get('sourceSha') == SOURCE_SHA and manifest.get('projectRef') == PROJECT and
              manifest.get('supabaseCliVersion') == '2.111.0' and
              manifest.get('includesStorageObjectBytes') is False and
              manifest.get('includesAuthStorageManagedSchemaCustomizations') is False and
              manifest.get('restoreExercised') is False, 'MANIFEST')
        rows = manifest.get('files')
        check(isinstance(rows, list) and len(rows) == 5 and all(isinstance(r, dict) for r in rows)
              and {r.get('name') for r in rows} == FILES, 'MANIFEST')
        for row in rows:
            data = archive.extractfile(row['name']).read()
            check(type(row.get('bytes')) is int and row['bytes'] == len(data) and
                  row.get('sha256') == sha(data), 'PAYLOAD')
    return 5

def gpg_environment():
    # No inherited GitHub credentials, backup secret, database URLs or debug flags.
    return {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8'}

def gpg_authenticated(code, status):
    tags = {line.split()[1] for line in status.splitlines()
            if line.startswith(b'[GNUPG:] ') and len(line.split()) >= 2}
    check(code == 0, 'GPG_EXIT')
    check({b'DECRYPTION_OKAY', b'GOODMDC'} <= tags and
          not tags & {b'DECRYPTION_FAILED', b'BADMDC', b'ERRMDC', b'FAILURE'}, 'GPG_STATUS')

def decrypt(cipher, directory, pass_fd):
    home = directory / 'gnupg'
    home.mkdir(mode=0o700)
    encrypted = directory / 'input.gpg'
    with encrypted.open('xb') as out:
        out.write(cipher)
    child = None
    try:
        with open(os.devnull, 'wb') as discard:
            args = ['gpg', '--no-options', '--homedir', str(home), '--batch', '--quiet',
                    '--no-tty', '--require-secmem', '--no-symkey-cache',
                    '--pinentry-mode', 'loopback', '--no-auto-key-retrieve',
                    '--auto-key-locate', 'clear', '--max-output', str(LIMIT),
                    '--logger-fd', str(discard.fileno()), '--status-fd', '2',
                    '--passphrase-fd', '0', '--decrypt', str(encrypted)]
            child = subprocess.Popen(args, stdin=pass_fd, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, pass_fds=(discard.fileno(),),
                                     env=gpg_environment())
            try:
                plain, status = child.communicate(timeout=TIMEOUT)
            except subprocess.TimeoutExpired:
                raise Stop('GPG_TIMEOUT') from None
            gpg_authenticated(child.returncode, status)
            del status
            check(0 < len(plain) <= LIMIT, 'MEMBERS')
            return plain
    except OSError:
        raise Stop('GPG_LAUNCH') from None
    finally:
        if child is not None and child.poll() is None:
            child.kill()
            child.wait()
        # Target only this operation's fresh, private agent; never a shared agent.
        try:
            killed = subprocess.run(['gpgconf', '--homedir', str(home), '--kill', 'gpg-agent'],
                                    env=gpg_environment(), stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL, timeout=10)
            check(killed.returncode == 0, 'CLEANUP')
        except (OSError, subprocess.TimeoutExpired):
            raise Stop('CLEANUP') from None

def verify(path, pass_fd=0):
    result = dict(operation='retained-backup-verification-only', status='FAIL',
                  archivePinned=False, cacheDisabledDecryption=False,
                  manifestAndMembersVerified=False, payloadHashesVerified=0,
                  temporaryFilesRemoved=False, restorePerformed=False,
                  databaseAccessed=False, acceptanceAwarded=False)
    directory = None
    try:
        check(path.is_file() and not path.is_symlink() and 0 < path.stat().st_size <= LIMIT,
              'INPUT_FILE')
        cipher = inspect_zip(path.read_bytes())
        result['archivePinned'] = True
        with tempfile.TemporaryDirectory(prefix='m18-verify-') as temporary:
            directory = Path(temporary)
            os.chmod(directory, 0o700)
            plain = decrypt(cipher, directory, pass_fd)
            result['cacheDisabledDecryption'] = True
            verified = inspect_plaintext(plain)
            del plain
            result['manifestAndMembersVerified'] = True
            result['payloadHashesVerified'] = verified
        result['status'] = 'PASS'
    except Stop as error:
        result['failure'] = error.code
    except (KeyboardInterrupt, SystemExit):
        result['failure'] = 'INTERRUPTED'
    except Exception:
        result['failure'] = 'INTERNAL'
    finally:
        result['temporaryFilesRemoved'] = directory is None or not directory.exists()
        if not result['temporaryFilesRemoved']:
            result['status'], result['failure'] = 'FAIL', 'CLEANUP'
    return result

def require_network_isolation():
    # A future approved Linux launcher must enter a fresh network namespace.
    # No downloads or network operations are implemented in this verifier.
    check(sys.platform == 'linux' and os.environ.get('GITHUB_ACTIONS') == 'true', 'ISOLATION')
    check(os.environ.get('GITHUB_REPOSITORY') == 'Blockigaming/KovaGPT', 'ISOLATION')
    check(os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted', 'ISOLATION')
    check(os.environ.get('RUNNER_DEBUG') != '1', 'ISOLATION')
    # /proc/self/net follows this process's current network namespace, even when
    # a parent namespace mounted sysfs. Never rely on a launcher flag alone.
    interfaces = {line.split(':', 1)[0].strip()
                  for line in Path('/proc/self/net/dev').read_text().splitlines()[2:]
                  if ':' in line}
    check(interfaces == {'lo'}, 'ISOLATION')

def main():
    os.umask(0o077)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:
        check(len(sys.argv) == 2, 'ARGUMENTS')
        require_network_isolation()
        result = verify(Path(sys.argv[1]))
        result['networkIsolated'] = True
    except Stop as error:
        result = {'status': 'FAIL', 'failure': error.code, 'restorePerformed': False,
                  'acceptanceAwarded': False}
    except BaseException:
        result = {'status': 'FAIL', 'failure': 'INTERNAL', 'restorePerformed': False,
                  'acceptanceAwarded': False}
    print(json.dumps(result, sort_keys=True, separators=(',', ':')))
    return 0 if result['status'] == 'PASS' else 1

if __name__ == '__main__':
    sys.exit(main())
