#!/usr/bin/env python3
"""Exercise schema/data restore commands on generated fixtures, never a backup.

The inherited PR-only, no-sensitive-environment, source-pin, native image,
no-swap, network and cleanup guards remain mandatory. No archive, phrase,
source connection or arbitrary SQL input is accepted. This proof cannot
qualify customer recovery or authorize a later restore.
"""
import importlib.util
import json
from pathlib import Path
import signal

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('schema_restore_synthetic_harness', HERE / 'smoke-synthetic-recovery-native.py')
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)
base = harness.base

PROGRAM = r'''import importlib.util,json,os,pathlib,sys,tempfile
path=pathlib.Path('/opt/kova/scripts/release/managed-auth-recovery.py')
spec=importlib.util.spec_from_file_location('synthetic_schema_restore_engine',path)
engine=importlib.util.module_from_spec(spec);spec.loader.exec_module(engine)
fixture=json.loads(sys.argv[1]);phase='fixture'
def connection(key):
 f=fixture[key]
 env={'PATH':os.environ['PATH'],'LANG':'C.UTF-8','LC_ALL':'C.UTF-8','TMPDIR':'/work',
  'PGPASSFILE':'/run/client/pgpass','APPROVED_ISOLATED_HOST':f['host'],
  'APPROVED_ISOLATED_DBNAME':'postgres','APPROVED_ISOLATED_PORT':'5432',
  'APPROVED_ISOLATED_SERVER_IP':f['ip'],'APPROVED_ISOLATED_SYSTEM_IDENTIFIER':f['systemIdentifier'],
  'APPROVED_ISOLATED_PG17_DATABASE_URL':'postgresql://kova_probe_operator@'+f['host']+
  ':5432/postgres?sslmode=verify-full&sslrootcert=/run/client/ca.crt'}
 approved=json.loads(engine.run(['node',str(engine.GUARD),'--configuration'],env,timeout=5))
 return approved,engine.target_environment(env,approved)
try:
 a,source=connection('a');b,target=connection('b')
 engine.psql(source,"""CREATE SCHEMA IF NOT EXISTS auth;
 CREATE SCHEMA IF NOT EXISTS storage;
 CREATE SCHEMA IF NOT EXISTS realtime;
 CREATE SCHEMA IF NOT EXISTS supabase_migrations;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE TABLE auth.identities(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id));
 CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id));
 CREATE TABLE public.kova_synthetic_restore(id integer PRIMARY KEY,payload text NOT NULL);
 ALTER TABLE public.kova_synthetic_restore ENABLE ROW LEVEL SECURITY;
 CREATE POLICY synthetic_positive ON public.kova_synthetic_restore USING(id>0) WITH CHECK(id>0);
 GRANT SELECT ON public.kova_synthetic_restore TO synthetic_granted_role;
 INSERT INTO public.kova_synthetic_restore VALUES(1,'KOVA_SYNTHETIC_ONLY');
 """)
 before=json.loads(engine.psql(source,engine.CATALOG_SQL));blank=json.loads(engine.psql(target,engine.CATALOG_SQL))
 with tempfile.TemporaryDirectory(prefix='synthetic-schema-roundtrip-',dir='/work') as directory:
  root=pathlib.Path(directory);archive=root/'generated-fixture.dump';selected=root/'schema.list';data_list=root/'data.list';data_sql=root/'data.sql'
  phase='dump';engine.mark_stage('restore-data-render')
  engine.run(['pg_dump','--no-password','--format=custom','--file',str(archive)],source)
  entries=engine.toc_entries(engine.run(['pg_restore','--list',str(archive)],source).decode())
  selected.write_bytes(engine.empty_schema_restore_list(entries,before,blank))
  phase='schema-restore';engine.mark_stage('restore-schema')
  engine.run(['pg_restore','--no-password','--exit-on-error','--single-transaction',
   '--section=pre-data','--section=post-data','--use-list',str(selected),'--dbname',b['uri'],str(archive)],target)
  phase='data-render';engine.mark_stage('restore-data-render')
  data_list.write_bytes(engine.data_restore_list(entries,set()))
  engine.run(['pg_restore','--data-only','--use-list',str(data_list),'--file',str(data_sql),str(archive)],target)
  phase='data-import';engine.mark_stage('restore-data-import')
  engine.run(['psql','-X','--no-password','--quiet','--single-transaction','--set','ON_ERROR_STOP=1',
   '--command','SET session_replication_role=replica','--file',str(data_sql),
   '--command','SET session_replication_role=origin'],target)
  phase='verify';engine.mark_stage('restore-verify')
  assert engine.psql(target,"SELECT payload FROM public.kova_synthetic_restore WHERE id=1;\n").strip()==b'KOVA_SYNTHETIC_ONLY'
  for table in ['users','identities','sessions']:
   assert engine.psql(target,'SELECT count(*) FROM auth.'+table+';\n').strip()==b'0'
  hashes=[]
  for name,env in [('source',source),('target',target)]:
   out=root/(name+'-schema.sql');engine.run(['pg_dump','--no-password','--schema-only','--file',str(out)],env)
   hashes.append(engine.schema_hash(out.read_bytes()))
  assert hashes[0]==hashes[1]
 print(json.dumps({'ok':True,'syntheticSchemaRestorePassed':True,'syntheticDataImportPassed':True,
  'schemaOwnersPoliciesPrivilegesEqual':True,'customerRowsUsed':False,'protectedPhraseUsed':False,
  'productionSourceConnected':False,'syntheticRowCount':1}))
except Exception as error:
 print(json.dumps({'ok':False,'phase':phase,'failure':engine.public_failure(error)}))
 raise SystemExit(1)
'''


class SchemaRestoreProbe(harness.SyntheticProbe):
    def restore_preflight(self, target, system, fingerprints):
        result = super().restore_preflight(target, system, fingerprints)
        if not hasattr(self, 'schema_restore_targets'):
            self.schema_restore_targets = {}
        self.schema_restore_targets[target] = {'host': self.hosts[target], 'ip': self.addresses[target][0],
                                               'systemIdentifier': system}
        if target == 'b':
            code, raw = self.docker(['exec', '--user', str(self.uid) + ':' + str(self.gid),
                                    self.names['client'], self.client_tools['python3'], '-c', PROGRAM,
                                    base.encoded(self.schema_restore_targets).decode()],
                                   timeout=240, allow_failure=True)
            try:
                proof = json.loads(raw)
            except (TypeError, ValueError):
                proof = {'ok': False, 'phase': 'unconfirmed'}
            self.schema_restore_proof = proof
            if code:
                # This database has only generated fixture rows. Still redact
                # this run's generated credential and retain a bounded tail.
                _, log = self.docker(['exec', self.names['b'], '/bin/cat', '/tmp/postgres.log'],
                                     timeout=10, allow_failure=True)
                self.schema_restore_diagnostic = harness.safe_diagnostic(
                    log, [self.password, *self._diagnostic_secrets], limit=2048)
            harness.require(code == 0 and proof.get('ok') is True,
                            'synthetic_restore_preflight_unqualified')
        return result

    def execute_synthetic(self):
        result = super().execute_synthetic()
        result['operation'] = 'data-free-native-generated-schema-restore'
        result['generatedSchemaRestore'] = getattr(self, 'schema_restore_proof', {'ok': False})
        result['productionSourceConnected'] = False
        result['customerBackupDecryptionPerformed'] = False
        result['restoreQualified'] = False
        if result['generatedSchemaRestore'].get('ok'):
            result['syntheticRestorePerformed'] = True
            result['ordinaryTargetRows'] = 2
        if hasattr(self, 'schema_restore_diagnostic'):
            result['syntheticOnlyDiagnostic'] = self.schema_restore_diagnostic
        # The shared main writes the one owned receipt after final cleanup.
        return result


harness.SyntheticProbe = SchemaRestoreProbe

if __name__ == '__main__':
    def interrupted(*_):
        raise harness.Stopped('synthetic_native_interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        harness.main()
    except Exception as error:
        print(json.dumps({'ok': False, 'error': 'synthetic_native_smoke_unqualified',
                          'primaryFailure': harness.failure_details(error), 'sourceProof': False}))
        raise SystemExit(1)
