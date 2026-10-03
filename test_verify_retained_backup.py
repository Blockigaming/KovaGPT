import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch
import zipfile
import re
import base64
import contextlib
import hashlib
import verify_retained_backup as v

ROOT = Path(__file__).resolve().parent
def workflow_source():
    published = ROOT / '.github/workflows/m18-verify-retained-secret.yml'
    review = ROOT / 'm18-verify-retained-secret.yml'
    return (published if published.is_file() else review).read_text()

def fixture_plain(change=None, member=None, extra=False, duplicate=False):
    values = {name: b'SELECT 1; -- synthetic only\n' for name in v.FILES}
    manifest = dict(schemaVersion=1, operation='supabase-production-logical-backup',
                    projectRef=v.PROJECT, sourceSha=v.SOURCE_SHA, supabaseCliVersion='2.111.0',
                    includesStorageObjectBytes=False, includesAuthStorageManagedSchemaCustomizations=False,
                    restoreExercised=False, files=[dict(name=n, bytes=len(b), sha256=v.sha(b)) for n,b in values.items()])
    if change:change(values, manifest)
    values['manifest.json'] = json.dumps(manifest).encode()
    if extra:values['unexpected.sql'] = b'extra'
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w') as archive:
        for name, data in values.items():
            entry = tarfile.TarInfo(name); entry.size = len(data)
            if member and name == 'data.sql':
                entry.name, entry.type, entry.linkname = member
                if not entry.isfile():entry.size=0
            archive.addfile(entry, io.BytesIO(data) if entry.isfile() else None)
            if duplicate and name=='data.sql':archive.addfile(entry,io.BytesIO(data))
    return output.getvalue()

def fixture_zip(change=None):
    cipher = b'synthetic cipher - no cryptographic claim'
    receipt = dict(schemaVersion=1, operation='supabase-production-logical-backup-evidence',
                   projectRef=v.PROJECT, sourceSha=v.SOURCE_SHA, encryptedArchiveSha256=v.sha(cipher),
                   encryptedArchiveBytes=len(cipher), plaintextUploaded=False, restoreExercised=False)
    if change:change(receipt)
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w') as z:
        z.writestr('backup-evidence.json',json.dumps(receipt))
        z.writestr('kova-production-backup.tar.gpg',cipher)
    return out.getvalue(),cipher

class Checks(unittest.TestCase):
    def test_pins_and_receipt(self):
        raw,cipher=fixture_zip()
        with patch.object(v,'ZIP_SHA',v.sha(raw)),patch.object(v,'CIPHER_SHA',v.sha(cipher)):
            self.assertEqual(v.inspect_zip(raw),cipher)
    def test_wrong_zip_pin_fails_before_crypto(self):
        with self.assertRaisesRegex(v.Stop,'ZIP_PIN'):v.inspect_zip(fixture_zip()[0])
    def test_wrong_cipher_pin_rejected(self):
        raw,_=fixture_zip()
        with patch.object(v,'ZIP_SHA',v.sha(raw)):
            with self.assertRaisesRegex(v.Stop,'CIPHER_PIN'):v.inspect_zip(raw)
    def test_receipt_bound_to_original_commit(self):
        raw,cipher=fixture_zip(lambda r:r.update(sourceSha='different'))
        with patch.object(v,'ZIP_SHA',v.sha(raw)),patch.object(v,'CIPHER_SHA',v.sha(cipher)):
            with self.assertRaisesRegex(v.Stop,'RECEIPT'):v.inspect_zip(raw)
    def test_all_five_payload_hashes(self):self.assertEqual(v.inspect_plaintext(fixture_plain()),5)
    def test_changed_payload_rejected(self):
        plain=fixture_plain(lambda values,m:values.update({'data.sql':b'altered'}))
        with self.assertRaisesRegex(v.Stop,'PAYLOAD'):v.inspect_plaintext(plain)
    def test_manifest_source_bound(self):
        plain=fixture_plain(lambda values,m:m.update(sourceSha='different'))
        with self.assertRaisesRegex(v.Stop,'MANIFEST'):v.inspect_plaintext(plain)
    def test_symlink_member_rejected(self):
        with self.assertRaisesRegex(v.Stop,'MEMBERS'):v.inspect_plaintext(fixture_plain(member=('data.sql',tarfile.SYMTYPE,'/secret')))
    def test_path_traversal_rejected(self):
        with self.assertRaisesRegex(v.Stop,'MEMBERS'):v.inspect_plaintext(fixture_plain(member=('../data.sql',tarfile.REGTYPE,'')))
    def test_extra_member_rejected(self):
        with self.assertRaisesRegex(v.Stop,'MEMBERS'):v.inspect_plaintext(fixture_plain(extra=True))
    def test_duplicate_member_rejected(self):
        with self.assertRaisesRegex(v.Stop,'MEMBERS'):v.inspect_plaintext(fixture_plain(duplicate=True))
    def test_duplicate_json_rejected(self):
        with self.assertRaises(v.Stop):v.parse_json(b'{"sourceSha":"one","sourceSha":"two"}')
    def test_nonzero_gpg_exit_never_passes(self):
        with self.assertRaisesRegex(v.Stop,'GPG_EXIT'):v.gpg_authenticated(2,b'[GNUPG:] DECRYPTION_OKAY\n[GNUPG:] GOODMDC\n')
    def test_success_status_and_integrity_required(self):
        with self.assertRaisesRegex(v.Stop,'GPG_STATUS'):v.gpg_authenticated(0,b'[GNUPG:] DECRYPTION_OKAY\n')
    def test_integrity_failure_rejected(self):
        with self.assertRaisesRegex(v.Stop,'GPG_STATUS'):v.gpg_authenticated(0,b'[GNUPG:] DECRYPTION_OKAY\n[GNUPG:] GOODMDC\n[GNUPG:] BADMDC\n')
    def test_success_status(self):v.gpg_authenticated(0,b'[GNUPG:] DECRYPTION_OKAY\n[GNUPG:] GOODMDC\n')
    def test_secret_and_db_credentials_not_in_gpg_environment(self):
        with patch.dict(os.environ,{'KOVA_PRODUCTION_BACKUP_PASSPHRASE_20260926':'synthetic','DATABASE_URL':'synthetic','GITHUB_TOKEN':'synthetic','GNUPGHOME':'synthetic'}):
            self.assertEqual(set(v.gpg_environment()),{'PATH','LANG','LC_ALL'})
    def test_gpg_fd_cache_flags_and_agent_cleanup(self):
        with tempfile.TemporaryDirectory() as tmp:
            calls=[]
            child=types.SimpleNamespace(returncode=0,poll=lambda:0,communicate=lambda **kw:(fixture_plain(),b'[GNUPG:] DECRYPTION_OKAY\n[GNUPG:] GOODMDC\n'))
            def popen(args,**kw):
                self.assertIn('--no-symkey-cache',args);self.assertIn('--no-options',args)
                self.assertIn('--require-secmem',args);self.assertIn('--pinentry-mode',args)
                self.assertEqual(args[args.index('--passphrase-fd')+1],'0')
                self.assertEqual(kw['stdin'],123);calls.append('gpg');return child
            def run(args,**kw):
                self.assertEqual(args[:1],['gpgconf']);self.assertIn(str(Path(tmp)/'gnupg'),args)
                self.assertEqual(args[-2:],['--kill','gpg-agent']);calls.append('cleanup')
                return types.SimpleNamespace(returncode=0)
            with patch.object(v.subprocess,'Popen',popen),patch.object(v.subprocess,'run',run):
                v.decrypt(b'cipher',Path(tmp),123)
            self.assertEqual(calls,['gpg','cleanup'])
    def exercise_verify(self, failure=False):
        raw,cipher=fixture_zip();folders=[]
        def decrypt(cipher,directory,fd):
            folders.append(directory);(directory/'encrypted-only').write_bytes(cipher)
            if failure:raise RuntimeError('PRIVATE VALUE MUST NOT APPEAR')
            return fixture_plain()
        with tempfile.TemporaryDirectory() as tmp:
            archive=Path(tmp)/'input.zip';archive.write_bytes(raw)
            with patch.object(v,'ZIP_SHA',v.sha(raw)),patch.object(v,'CIPHER_SHA',v.sha(cipher)),patch.object(v,'decrypt',decrypt):
                result=v.verify(archive)
            self.assertTrue(result['temporaryFilesRemoved']);self.assertFalse(result['acceptanceAwarded'])
            self.assertFalse(result['restorePerformed']);self.assertFalse(result['databaseAccessed'])
            self.assertNotIn('PRIVATE',json.dumps(result));self.assertNotIn('SELECT',json.dumps(result))
            self.assertTrue(all(not p.exists() for p in folders))
            self.assertEqual(result['status'],'FAIL' if failure else 'PASS')
            self.assertEqual(result['payloadHashesVerified'],0 if failure else 5)
    def test_sanitized_success_and_cleanup(self):self.exercise_verify()
    def test_sanitized_failure_and_cleanup(self):self.exercise_verify(True)
    def test_unapproved_local_context_cannot_execute(self):
        with patch.dict(os.environ,{},clear=True):
            with self.assertRaisesRegex(v.Stop,'ISOLATION'):v.require_network_isolation()
    def test_timeout_and_interrupt_terminate_child_and_private_agent(self):
        for failure in (subprocess.TimeoutExpired('gpg',120),KeyboardInterrupt()):
            with self.subTest(kind=type(failure).__name__),tempfile.TemporaryDirectory() as tmp:
                events=[]
                def communicate(**kw):raise failure
                child=types.SimpleNamespace(returncode=None,poll=lambda:None,communicate=communicate,
                                            kill=lambda:events.append('kill'),wait=lambda:events.append('wait'))
                def cleanup(*args,**kw):events.append('agent-cleanup');return types.SimpleNamespace(returncode=0)
                with patch.object(v.subprocess,'Popen',return_value=child),patch.object(v.subprocess,'run',cleanup):
                    with self.assertRaises((v.Stop,KeyboardInterrupt)):v.decrypt(b'cipher',Path(tmp),0)
                self.assertEqual(events,['kill','wait','agent-cleanup'])
    def test_agent_cleanup_failure_prevents_pass(self):
        with tempfile.TemporaryDirectory() as tmp:
            child=types.SimpleNamespace(returncode=0,poll=lambda:0,communicate=lambda **kw:(fixture_plain(),b'[GNUPG:] DECRYPTION_OKAY\n[GNUPG:] GOODMDC\n'))
            with patch.object(v.subprocess,'Popen',return_value=child),patch.object(v.subprocess,'run',return_value=types.SimpleNamespace(returncode=1)):
                with self.assertRaisesRegex(v.Stop,'CLEANUP'):v.decrypt(b'cipher',Path(tmp),0)
    def test_only_loopback_namespace_is_accepted(self):
        trusted={'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':'Blockigaming/KovaGPT','RUNNER_ENVIRONMENT':'github-hosted'}
        with patch.dict(os.environ,trusted,clear=True),patch.object(v.sys,'platform','linux'):
            with patch.object(v.Path,'read_text',return_value='header\nheader\n lo: 0 0 0\n'):v.require_network_isolation()
            with patch.object(v.Path,'read_text',return_value='header\nheader\n lo: 0 0 0\n eth0: 0 0 0\n'):
                with self.assertRaisesRegex(v.Stop,'ISOLATION'):v.require_network_isolation()
    def test_debug_runner_cannot_receive_secret(self):
        trusted={'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':'Blockigaming/KovaGPT','RUNNER_ENVIRONMENT':'github-hosted','RUNNER_DEBUG':'1'}
        with patch.dict(os.environ,trusted,clear=True),patch.object(v.sys,'platform','linux'):
            with self.assertRaisesRegex(v.Stop,'ISOLATION'):v.require_network_isolation()
    def test_workflow_maps_only_original_secret_and_temporary_private_input(self):
        source=workflow_source()
        self.assertEqual(set(re.findall(r'secrets\.([A-Z0-9_]+)',source)),{'KOVA_PRODUCTION_BACKUP_PASSPHRASE_20260926'} | {'M18_RETAINED_ZIP_PART'+str(i)+'_20261003' for i in range(1,5)})
        for forbidden in ('KOVA_PRODUCTION_DATABASE_URL','upload-artifact','actions/cache','azure/login','workflow_dispatch','supabase db','set -x','urllib','curl '):
            self.assertNotIn(forbidden,source)
        self.assertIn('timeout-minutes: 5',source);self.assertIn('permissions:\n  contents: read',source)
        self.assertIn('environment: production',source);self.assertIn('runs-on: ubuntu-24.04',source)
        self.assertIn('unshare --net python3 -I -S',source);self.assertIn('if: always()',source)
    def test_workflow_code_pin_is_current(self):
        code=(ROOT/'verify_retained_backup.py').read_bytes()
        self.assertIn(v.sha(code),workflow_source())
    def exercise_input_reconstruction(self, mode):
        import textwrap
        source=workflow_source().split("<<'PY'\n",1)[1].split('\n          PY\n',1)[0]
        program=compile(textwrap.dedent(source),'<reviewed-input-step>','exec')
        raw=b'synthetic-encrypted-input'.ljust(152310,b'x')
        encoded=base64.b85encode(raw).decode('ascii')
        env={'M18_ZIP_PART'+str(i+1):encoded[i*48000:(i+1)*48000] for i in range(4)}
        if mode=='missing':del env['M18_ZIP_PART2']
        with tempfile.TemporaryDirectory() as tmp:
            env['RUNNER_TEMP']=tmp
            output=io.StringIO()
            patch_sha=patch.object(hashlib,'sha256',return_value=types.SimpleNamespace(hexdigest=lambda:v.ZIP_SHA)) if mode=='valid' else contextlib.nullcontext()
            with patch.dict(os.environ,env,clear=True),patch_sha,contextlib.redirect_stdout(output):
                if mode=='valid':exec(program,{'__name__':'__main__'})
                else:
                    with self.assertRaises(SystemExit) as stopped:exec(program,{'__name__':'__main__'})
                    self.assertEqual(stopped.exception.code,1)
                self.assertFalse(any('M18_ZIP_PART'+str(i) in os.environ for i in range(1,5)))
            file=Path(tmp)/'m18-retained-input/input.zip'
            if mode=='valid':
                self.assertEqual(file.read_bytes(),raw);self.assertEqual(output.getvalue(),'')
            else:
                self.assertFalse(file.exists())
                self.assertEqual(json.loads(output.getvalue()),{'status':'FAIL','stage':'encrypted_input','secretUsed':False})
    def test_protected_input_reconstruction_preserves_bytes(self):self.exercise_input_reconstruction('valid')
    def test_incorrect_protected_input_pin_fails_closed(self):self.exercise_input_reconstruction('wrong-pin')
    def test_missing_protected_input_part_fails_closed(self):self.exercise_input_reconstruction('missing')

if __name__=='__main__':unittest.main(verbosity=2)
