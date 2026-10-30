"""Public-manifest mutations and disposable embedded-PG SQL checks.

The embedded runtime reports its actual version; it is never native17 evidence.
No source connector, production database, Docker, credentials or customer rows.
"""
import copy
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
SCRIPT=ROOT/"scripts/release/extension-routine-type-hash-query.py"
spec=importlib.util.spec_from_file_location("hash_query",SCRIPT)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
payload_spec=importlib.util.spec_from_file_location("payload_manifest",SCRIPT.with_name("extension-routine-type-payloads.py"))
p=importlib.util.module_from_spec(payload_spec);payload_spec.loader.exec_module(p)


def generic_fixture_identity(catalog,alias,ordinary_identity):
    if catalog in m.CATALOGS:return m.row_key(catalog,alias)
    return ordinary_identity(catalog,alias+'.oid')


def forbidden_file_callback(alias,ordinary):
    return "pg_catalog.pg_read_file('/synthetic-forbidden')"


class HashQueryTests(unittest.TestCase):
    def test_generated_sql_is_exactly_current_reviewable_source(self):
        actual=SCRIPT.with_name("extension-routine-type-payload-hashes.sql").read_text()
        self.assertEqual(m.build_query(p.MANIFESTS),actual)
        self.assertEqual(m.foreign_keys(p.MANIFESTS),p.FOREIGN_KEYS)

    def test_unknown_catalog_column_identifier_adapter_or_type_is_not_silently_dropped(self):
        mutations=[lambda x:x.update(private_catalog=x.pop("pg_proc")),
                   lambda x:x["pg_proc"].update({'column";DROP TABLE x':x["pg_proc"]["prosrc"]}),
                   lambda x:x["pg_proc"]["prosrc"].update(kind="unknown"),
                   lambda x:x["pg_proc"]["prosrc"].update(type="unknown"),
                   lambda x:x["pg_proc"]["prosrc"].update(extra="unsupported"),
                   lambda x:x["pg_proc"]["proargtypes"].update(optional="false")]
        for mutate in mutations:
            changed=copy.deepcopy(p.MANIFESTS);mutate(changed)
            with self.assertRaises(ValueError):m.build_query(changed)

    def test_exact_oid_scalar_acl_array_and_opaque_boundaries_are_present(self):
        text=m.build_query(p.MANIFESTS)
        for value in ["pg_identify_object_as_address","pg_get_object_address","i.classid::oid",
                      "float4send","namesend","textsend","charsend","boolsend","int2send","int4send",
                      "array_lower","array_length","WITH ORDINALITY","aclexplode","::text)::aclitem=",
                      "zero-reference","enum-label","labelHex","non_opaque_payload","rawNodeSha256",
                      "column_differences","foreign_key_differences"]:self.assertIn(value,text)
        for bad in ["pg_get_functiondef","pg_get_expr","pg_describe_object","regexp_replace","oid>16384"]:
            self.assertNotIn(bad,text)

    def test_exact_server_encoding_transaction_and_scope_gates_cannot_claim_complete_recovery(self):
        text=m.build_query(p.MANIFESTS)
        for value in ["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", "SET LOCAL search_path=pg_catalog",
                      "current_setting('server_version_num')::integer=170006", "current_setting('server_encoding')='UTF8'",
                      "current_setting('transaction_read_only')='on'", "current_setting('transaction_isolation')='repeatable read'",
                      "'qualificationReady',false", "'semanticEqualityProven',false", "'otherExtensionClassesCovered',false",
                      "'opaqueNodeHashesAreRawBindings',true"]:self.assertIn(value,text)
        final=text.split("\nSELECT jsonb_build_object(\n",1)[1]
        for raw in ["prosrc","probin","proconfig","proacl","enumlabel","object_names","extensionoid"]:
            self.assertNotIn(raw,final)

    def test_no_write_statement_or_application_row_source_is_generated(self):
        text=m.build_query(p.MANIFESTS)
        for bad in ["CREATE FUNCTION","CREATE TABLE","UPDATE ","DELETE ","INSERT ","COPY ",
                    "FROM auth.","FROM storage.","FROM public.","pg_authid.rolpassword"]:
            self.assertNotIn(bad,text)
        self.assertEqual(text.count("COMMIT;"),1)

    def test_existing_snapshot_body_never_starts_or_changes_caller_transaction_or_accepts_snapshot_literal(self):
        body=m.build_query(p.MANIFESTS,transaction_wrapper=False)
        for statement in ["BEGIN ISOLATION LEVEL","SET LOCAL ","COMMIT;"]:
            self.assertNotIn(statement,body)
        self.assertIn("WITH RECURSIVE",body)
        for value in ["current_setting('transaction_read_only')='on'","current_setting('transaction_isolation')='repeatable read'",
                      "current_setting('search_path')='pg_catalog'","pg_current_snapshot()::text","'captureSnapshotBound',false"]:
            self.assertIn(value,body)
        with self.assertRaises(ValueError):m.build_query(p.MANIFESTS,transaction_wrapper="untrusted-snapshot")

    def test_private_wire_is_api_only_same_snapshot_and_guarded_before_scope_and_raw_projection(self):
        text=m.build_private_wire_query(p.MANIFESTS)
        self.assertTrue(text.startswith("-- PRIVATE_GHA_ONLY"))
        for value in ["private_wire_gate AS MATERIALIZED","PRIVATE_GHA_CAPTURE_ONLY",
                      "AND (SELECT allowed FROM private_wire_gate)","SELECT CASE WHEN (SELECT allowed FROM private_wire_gate)",
                      "'private_wire_context_or_layout_denied'","'nodeReferenceCoverageComplete',false",
                      "'typeLayoutsComplete',false","'querySha256MustBeBoundByPrivateWrapper',true",
                      "'captureSnapshotBound',false","'sourceSnapshotSha256'","'resolvedReferences'",
                      "'catalogColumns'","'catalogForeignKeys'","'extensionOid'","'values'"]:
            self.assertIn(value,text)
        for statement in ["BEGIN ISOLATION LEVEL","SET LOCAL ","COMMIT;","FROM pg_authid","rolpassword"]:
            self.assertNotIn(statement,text)
        public=m.build_query(p.MANIFESTS)
        self.assertNotIn("PRIVATE_GHA_CAPTURE_ONLY",public)
        self.assertNotIn("'privateRawWire',true",public)

    def test_generic_private_api_only_accepts_known_catalogs_fields_kinds_and_reviewed_local_sql(self):
        extra=json.loads((ROOT/"scripts/release/pg17-extension-relation-manifest.json").read_text())
        merged={**p.MANIFESTS,**extra["catalogs"]}
        m.validate_capture_manifests(merged)
        self.assertEqual(set(m.default_scope_queries(merged)),set(merged))
        for mutate in [lambda x:x.update(pg_private_new=x.pop("pg_proc")),
                       lambda x:x["pg_class"]["relname"].update(kind="unknown"),
                       lambda x:x["pg_class"]["relowner"].update(ref="pg_unknown_catalog"),
                       lambda x:x["pg_class"]["relname"].update(kind="excluded_physical",reason="not physical")]:
            changed=copy.deepcopy(merged);mutate(changed)
            with self.assertRaises(ValueError):m.validate_capture_manifests(changed)
        for value in ["SELECT pg_read_file('/synthetic')","SELECT * FROM public.customer_rows", "SELECT * FROM pg_authid",
                      "SELECT 1; DELETE FROM pg_proc"]:
            with self.assertRaises(ValueError):m.checked_local_sql(value)
        with self.assertRaises(ValueError):m.build_capture_all_private_wire_query(p.MANIFESTS,address_identity_sql=forbidden_file_callback)
        with self.assertRaises(ValueError):m.build_capture_all_private_wire_query(p.MANIFESTS,address_identity_sql="source-provided string")

    def test_generic_merged_body_has_explicit_compound_fks_scopes_and_no_private_static_file(self):
        extra=json.loads((ROOT/"scripts/release/pg17-extension-relation-manifest.json").read_text())
        manifests={**p.MANIFESTS,**extra["catalogs"]}
        fks=[*p.FOREIGN_KEYS,*extra["foreignKeys"]]
        text=m.build_capture_all_private_wire_query(manifests,identity_sql=generic_fixture_identity,catalog_foreign_keys=fks)
        for value in ["private_wire_gate AS MATERIALIZED","unsupported_values_absent","duplicate_row_keys",
                      "scoped_catalogs_covered","'catalogIdentities'","'nodeReferenceCoverageComplete',false",
                      "'typeLayoutsComplete',false",'"indrelid","indkey"',"relation_scope", "pg_description_scope",
                      "'composite type'", "t.typrelid=c.oid", "c.relkind='c'", "extension_roots",
                      "scope AS (SELECT * FROM extension_roots UNION SELECT * FROM extension_owned",
                      "owned_sequence_candidates", "sequence_ownership_ok AND scoped_catalogs_covered"]:
            self.assertIn(value,text)
        for value in ["COMMIT;","BEGIN ISOLATION LEVEL","SET LOCAL ","FROM pg_authid","rolpassword"]:
            self.assertNotIn(value,text)
        self.assertFalse(any("private" in file.name.lower() for file in SCRIPT.parent.glob("*routine*type*.sql")))

    def test_private_wire_negative_guards_and_synthetic_dto_match_private_adapter_contract(self):
        if shutil.which("node") is None or not (ROOT/"node_modules/@electric-sql/pglite").is_dir():
            self.skipTest("embedded-PG fixture unavailable; native17 remains unproved")
        query=m.build_private_wire_query(p.MANIFESTS)
        # Exercise the wire shape in disposable PG18; never disguise this
        # explicit fixture-only version comparison as nativePG17 acceptance.
        fixture_query=query.replace("current_setting('server_version_num')::integer=170006","current_setting('server_version_num')::integer>=170000")
        with tempfile.TemporaryDirectory(prefix="synthetic-wire-") as folder:
            native=Path(folder)/"actual-guard.sql";fixture=Path(folder)/"fixture-only-version.sql"
            native.write_text(query);fixture.write_text(fixture_query)
            script=r"""
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
const db=await PGlite.create();
const native=readFileSync(process.argv[2],'utf8'),fixture=readFileSync(process.argv[3],'utf8');
const run=async(query)=>JSON.parse(Object.values((await db.query(query)).rows[0])[0]);
try {
 await db.exec(`CREATE TYPE public.wire_enum AS ENUM ('SYNTHETIC_LABEL'); ALTER EXTENSION plpgsql ADD TYPE public.wire_enum;
 CREATE TYPE public.wire_composite AS (item integer); ALTER EXTENSION plpgsql ADD TYPE public.wire_composite;`);
 await db.exec(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog;`);
 const missing=await run(fixture);assert.equal(missing.privateRawWire,false);assert.equal('rows' in missing,false);
 await db.exec(`SET LOCAL kova.private_extension_wire='PRIVATE_GHA_CAPTURE_ONLY';`);
 const wrongVersion=await run(native);assert.equal(wrongVersion.privateRawWire,false);assert.equal('resolvedReferences' in wrongVersion,false);
 const wire=await run(fixture);assert.equal(wire.privateRawWire,true);assert.equal(wire.qualificationReady,false);
 assert.equal(wire.nodeReferenceCoverageComplete,false);assert.equal(wire.typeLayoutsComplete,false);
 assert.notEqual(wire.serverVersionNum,170006);
 const stillOpen=(await db.query(`SELECT current_setting('transaction_isolation') AS isolation`)).rows[0];
 assert.equal(stillOpen.isolation,'repeatable read');
 await db.exec('COMMIT');
 // Internal subprocess pipe carries only synthetic fixtures to this unittest;
 // the unittest never logs this wire or saves a plaintext artifact.
 process.stdout.write(JSON.stringify(wire));
} finally {await db.close();}
"""
            result=subprocess.run(["node","--input-type=module","-",str(native),str(fixture)],input=script.encode(),cwd=ROOT,
                                  stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=45)
        self.assertEqual(result.returncode,0,result.stderr.decode())
        wire=json.loads(result.stdout)
        self.assertNotEqual(wire["serverVersionNum"],170006)
        self.assertFalse(wire["captureSnapshotBound"])
        self.assertRegex(wire["sourceSnapshotSha256"],r"^[a-f0-9]{64}$")
        lookup={(entry["catalog"],entry["oid"],entry["subid"]):{"identity":entry["identity"],"roundtrip":entry["roundtrip"]}
                for entry in wire["resolvedReferences"]}
        resolver=p.VerifiedResolver(lambda catalog,oid,subid:lookup[(catalog,oid,subid)])
        count=0
        for row in wire["rows"]:
            if any(field["kind"]=="node" and row["values"][name] is not None
                   for name,field in p.MANIFESTS[row["catalog"]].items()):continue
            normalized=p.canonicalize_row(row,resolver)
            self.assertTrue(normalized);count+=1
        self.assertGreater(count,0)
        self.assertTrue(any(row["catalog"]=="pg_enum" for row in wire["rows"]))
        self.assertTrue(any(reference["catalog"]=="pg_class" and reference["identity"].get("type")=="composite type"
                            and reference["roundtrip"] is True for reference in wire["resolvedReferences"]))

    def test_generic_private_sql_runs_embedded_with_known_extra_catalog_and_preserves_unknown_scope_denial(self):
        if shutil.which("node") is None or not (ROOT/"node_modules/@electric-sql/pglite").is_dir():
            self.skipTest("embedded-PG fixture unavailable; native17 remains unproved")
        extra=json.loads((ROOT/"scripts/release/pg17-extension-relation-manifest.json").read_text())
        manifests={**p.MANIFESTS,**{name:extra["catalogs"][name] for name in ["pg_extension","pg_language"]}}
        fks=[*p.FOREIGN_KEYS,*[x for x in extra["foreignKeys"] if x["catalog"] in {"pg_extension","pg_language"}]]
        actual=m.build_capture_all_private_wire_query(manifests,identity_sql=generic_fixture_identity,catalog_foreign_keys=fks)
        fixture=actual.replace("current_setting('server_version_num')::integer=170006","current_setting('server_version_num')::integer>=170000")
        missing=m.build_capture_all_private_wire_query(p.MANIFESTS)
        missing=missing.replace("current_setting('server_version_num')::integer=170006","current_setting('server_version_num')::integer>=170000")
        with tempfile.TemporaryDirectory(prefix="synthetic-all-wire-") as folder:
            path=Path(folder)/"fixture.sql";path.write_text(fixture)
            absent=Path(folder)/"missing-scope.sql";absent.write_text(missing)
            script=r"""
import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';
const db=await PGlite.create();try {
 await db.exec(`CREATE TYPE public.generic_wire_enum AS ENUM ('SYNTHETIC_VALUE'); ALTER EXTENSION plpgsql ADD TYPE public.generic_wire_enum;`);
 await db.exec(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog; SET LOCAL kova.private_extension_wire='PRIVATE_GHA_CAPTURE_ONLY';`);
 const run=async(path)=>JSON.parse(Object.values((await db.query(readFileSync(path,'utf8'))).rows[0])[0]);
 const wire=await run(process.argv[2]);assert.equal(wire.privateRawWire,true);assert.equal(wire.qualificationReady,false);
 assert.ok(wire.rows.some(r=>r.catalog==='pg_language'));assert.ok(wire.catalogIdentities.some(r=>r.catalog==='pg_authid'));
 assert.equal(wire.nodeReferenceCoverageComplete,false);assert.equal(wire.typeLayoutsComplete,false);
 const denied=await run(process.argv[3]);assert.equal(denied.privateRawWire,false);assert.equal('rows' in denied,false);
 await db.exec('COMMIT');process.stdout.write(JSON.stringify({actualVersion:wire.serverVersionNum,
   genericExtraCatalog:true,unknownScopeDenied:true,native17Qualified:false})+'\n');
} catch(error) {process.stderr.write(JSON.stringify({code:error.code,message:error.message})+'\n');process.exitCode=1;}
finally {await db.close();}
"""
            result=subprocess.run(["node","--input-type=module","-",str(path),str(absent)],input=script.encode(),cwd=ROOT,
                stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=45)
        self.assertEqual(result.returncode,0,result.stderr.decode())
        evidence=json.loads(result.stdout);self.assertNotEqual(evidence["actualVersion"],170006)
        self.assertTrue(evidence["genericExtraCatalog"]);self.assertTrue(evidence["unknownScopeDenied"])

    def test_zero_member_extension_roots_retain_native_config_filter_comments_and_dependency_metadata(self):
        if shutil.which("node") is None or not (ROOT/"node_modules/@electric-sql/pglite").is_dir():
            self.skipTest("embedded-PG fixture unavailable; native17 remains unproved")
        def load(name):
            spec=importlib.util.spec_from_file_location(name,ROOT/"scripts/release"/(name+".py"))
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
        relations=load("extension-relation-payloads");hooks=load("extension-relation-query-hooks")
        selected={"pg_extension","pg_description","pg_depend","pg_shdepend"}
        manifests={name:fields for name,fields in relations.MANIFESTS.items() if name in selected}
        query=m.build_capture_all_private_wire_query(manifests,common_ctes=hooks.common_ctes(m),
            identity_sql=hooks.row_identity_sql,address_identity_sql=hooks.address_identity_sql,
            address_roundtrip_sql=hooks.address_roundtrip_sql,
            catalog_foreign_keys=[row for row in relations.FOREIGN_KEYS if row["catalog"] in selected])
        # Only the disposable PG18 fixture version gate is adapted here. The
        # emitted production SQL still requires exact PG17.6 and catalog layout.
        fixture=query.replace("current_setting('server_version_num')::integer=170006",
                              "current_setting('server_version_num')::integer>=170000")
        with tempfile.TemporaryDirectory(prefix="synthetic-extension-root-") as folder:
            path=Path(folder)/"fixture-only-version.sql";path.write_text(fixture)
            script=r"""
import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';
const db=await PGlite.create();const query=readFileSync(process.argv[2],'utf8');
const hex=text=>Buffer.from(text,'utf8').toString('hex');
try {
 // ALTER removes extension membership only in this disposable native fixture.
 await db.exec(`DROP EXTENSION plpgsql; CREATE ROLE synthetic_owner SUPERUSER;
   SET ROLE synthetic_owner; CREATE EXTENSION plpgsql; RESET ROLE;
   ALTER EXTENSION plpgsql DROP LANGUAGE plpgsql;
   ALTER EXTENSION plpgsql DROP FUNCTION pg_catalog.plpgsql_call_handler();
   ALTER EXTENSION plpgsql DROP FUNCTION pg_catalog.plpgsql_inline_handler(internal);
   ALTER EXTENSION plpgsql DROP FUNCTION pg_catalog.plpgsql_validator(oid);
   CREATE SCHEMA synthetic_extension_schema;
   UPDATE pg_extension SET extrelocatable=true WHERE extname='plpgsql';
   ALTER EXTENSION plpgsql SET SCHEMA synthetic_extension_schema;
   CREATE TABLE public.synthetic_configuration (id integer);
   COMMENT ON EXTENSION plpgsql IS 'SYNTHETIC_ROOT_COMMENT';`);
 assert.equal(Number((await db.query(`SELECT count(*) AS n FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
   WHERE d.refclassid='pg_extension'::regclass AND d.deptype='e'`)).rows[0].n),0);
 // Synthetic catalog edits model extension-script configuration metadata;
 // no production or remote connection exists in this test.
 await db.exec(`UPDATE pg_extension SET extconfig=ARRAY['public.synthetic_configuration'::regclass]::oid[],
   extcondition=ARRAY['WHERE id > 1']::text[] WHERE extname='plpgsql';`);
 const run=async()=>{await db.exec(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
   SET LOCAL search_path=pg_catalog; SET LOCAL kova.private_extension_wire='PRIVATE_GHA_CAPTURE_ONLY';`);
   try{return JSON.parse(Object.values((await db.query(query)).rows[0])[0]);}finally{await db.exec('COMMIT');}};
 const wire=await run();assert.equal(wire.privateRawWire,true);assert.equal(wire.qualificationReady,false);
 const root=wire.rows.find(row=>row.catalog==='pg_extension');assert.ok(root);
 assert.equal(root.extensionOid,root.values.oid);assert.equal(root.values.extname.bytesHex,hex('plpgsql'));
 assert.deepEqual(root.values.extcondition,{dimensions:[{lower:1,length:1}],items:[{isNull:false,bytesHex:hex('WHERE id > 1')}]});
 assert.equal(root.values.extconfig.dimensions[0].length,1);assert.equal(root.values.extconfig.items.length,1);
 assert.ok(wire.rows.some(row=>row.catalog==='pg_description' && row.values.objoid===root.values.oid &&
   row.values.description.bytesHex===hex('SYNTHETIC_ROOT_COMMENT')));
 assert.ok(wire.rows.some(row=>row.catalog==='pg_depend' && row.values.objid===root.values.oid));
 assert.ok(wire.rows.some(row=>row.catalog==='pg_shdepend' && row.values.objid===root.values.oid));
 assert.ok(wire.resolvedReferences.some(ref=>ref.catalog==='pg_class' && ref.oid===root.values.extconfig.items[0] && ref.roundtrip));
 await db.exec(`COMMENT ON EXTENSION plpgsql IS 'SYNTHETIC_ROOT_CHANGED';
   UPDATE pg_extension SET extcondition=ARRAY['WHERE id > 2']::text[] WHERE extname='plpgsql';`);
 const changed=await run();assert.equal(changed.privateRawWire,true);
 assert.notDeepEqual(changed.rows,wire.rows);
 assert.equal(changed.rows.find(row=>row.catalog==='pg_extension').values.extcondition.items[0].bytesHex,hex('WHERE id > 2'));
 process.stdout.write(JSON.stringify({zeroMemberRoot:true,comments:true,config:true,filter:true,
   dependencies:true,actualVersion:wire.serverVersionNum,native17Qualified:false})+'\n');
} catch(error){process.stderr.write(JSON.stringify({code:error.code,message:error.message})+'\n');process.exitCode=1;}
finally{await db.close();}
"""
            result=subprocess.run(["node","--input-type=module","-",str(path)],input=script.encode(),cwd=ROOT,
                                  stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=45)
        self.assertEqual(result.returncode,0,result.stderr.decode())
        evidence=json.loads(result.stdout)
        self.assertTrue(all(evidence[key] for key in ["zeroMemberRoot","comments","config","filter","dependencies"]))
        self.assertNotEqual(evidence["actualVersion"],170006);self.assertFalse(evidence["native17Qualified"])

    def test_column_owned_identity_and_serial_sequences_are_scoped_uniquely_and_malformed_links_block(self):
        if shutil.which("node") is None or not (ROOT/"node_modules/@electric-sql/pglite").is_dir():
            self.skipTest("embedded-PG fixture unavailable; native17 remains unproved")
        # Exercise the exact common scope CTE independently of the final PG17
        # wire/layout gates, using synthetic nativePG18 metadata only. The
        # final capture query separately requires sequence_ownership_ok.
        query="WITH RECURSIVE private_wire_gate AS (SELECT true AS allowed),"+m.DEFAULT_ALL_COMMON_CTES+"""
SELECT jsonb_build_object('ownershipOkay',NOT EXISTS(SELECT 1 FROM sequence_ownership_failures),
  'sequences',(SELECT jsonb_agg(jsonb_build_object(
    'identity',to_jsonb(pg_identify_object_as_address('pg_class'::regclass,c.oid,0)),
    'owner',to_jsonb(pg_identify_object_as_address('pg_authid'::regclass,c.relowner,0)),
    'acl',c.relacl::text,'comment',obj_description(c.oid,'pg_class'),
    'definition',(to_jsonb(s)-'seqrelid'-'seqtypid')||jsonb_build_object(
      'type',to_jsonb(pg_identify_object_as_address('pg_type'::regclass,s.seqtypid,0))),
    'ownerDependencies',(SELECT jsonb_agg(jsonb_build_object('kind',d.deptype,'objectSubid',d.objsubid,
      'reference',to_jsonb(pg_identify_object_as_address(d.refclassid,d.refobjid,d.refobjsubid))))
      FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid
        AND d.refclassid='pg_class'::regclass AND d.deptype IN ('a','i')),
    'classScoped',EXISTS(SELECT 1 FROM scope p WHERE p.classid='pg_class'::regclass AND p.objid=c.oid AND p.objsubid=0),
    'sequenceScoped',EXISTS(SELECT 1 FROM scope p JOIN pg_sequence q ON p.classid='pg_class'::regclass
      AND p.objid=q.seqrelid AND p.objsubid=0 WHERE q.seqrelid=c.oid),
    'columnsScoped',EXISTS(SELECT 1 FROM pg_attribute a JOIN relation_scope r ON a.attrelid=r.relid
      WHERE a.attrelid=c.oid AND a.attnum>0)) ORDER BY c.relname COLLATE "C")
    FROM owned_sequences o JOIN pg_class c ON c.oid=o.relid JOIN pg_sequence s ON s.seqrelid=c.oid))::text
"""
        with tempfile.TemporaryDirectory(prefix="synthetic-owned-sequence-") as folder:
            path=Path(folder)/"scope-only-no-native17-claim.sql";path.write_text(query)
            script=r"""
import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';
const a=await PGlite.create(),b=await PGlite.create();const query=readFileSync(process.argv[2],'utf8');
const run=async db=>JSON.parse(Object.values((await db.query(query)).rows[0])[0]);
const setup=`CREATE ROLE synthetic_sequence_reader; CREATE ROLE synthetic_sequence_owner;
 CREATE SEQUENCE public.synthetic_unowned_sequence;
 CREATE TABLE public.synthetic_extension_table(identity_id integer GENERATED ALWAYS AS IDENTITY,
   serial_id serial,unowned_id bigint DEFAULT nextval('public.synthetic_unowned_sequence'));
 CREATE INDEX synthetic_extension_index ON public.synthetic_extension_table(serial_id);
 ALTER EXTENSION plpgsql ADD TABLE public.synthetic_extension_table;
 COMMENT ON SEQUENCE public.synthetic_extension_table_serial_id_seq IS 'SYNTHETIC_SEQUENCE_COMMENT';
 GRANT USAGE ON SEQUENCE public.synthetic_extension_table_serial_id_seq TO synthetic_sequence_reader;`;
try {
 await b.exec(`CREATE ROLE unrelated_oid_shift; CREATE TABLE public.unrelated_oid_shift(id integer);`);
 await a.exec(setup);await b.exec(setup);
 const x=await run(a),y=await run(b);assert.deepEqual(x,y);assert.equal(x.ownershipOkay,true);
 assert.equal(x.sequences.length,2);assert.ok(x.sequences.every(s=>s.classScoped&&s.sequenceScoped&&s.columnsScoped));
 assert.notEqual((await a.query(`SELECT 'public.synthetic_extension_table'::regclass::oid AS oid`)).rows[0].oid,
   (await b.query(`SELECT 'public.synthetic_extension_table'::regclass::oid AS oid`)).rows[0].oid);
 assert.ok(!JSON.stringify(x).includes('synthetic_unowned_sequence'));
 for(const sql of [
   `ALTER SEQUENCE public.synthetic_extension_table_serial_id_seq INCREMENT 3`,
   `ALTER TABLE public.synthetic_extension_table OWNER TO synthetic_sequence_owner`,
   `GRANT SELECT ON SEQUENCE public.synthetic_extension_table_serial_id_seq TO synthetic_sequence_reader`,
   `COMMENT ON SEQUENCE public.synthetic_extension_table_serial_id_seq IS 'SYNTHETIC_SEQUENCE_CHANGED'`
 ]) {await a.exec('BEGIN');try{await a.exec(sql);const changed=await run(a);assert.equal(changed.ownershipOkay,true);
     assert.notDeepEqual(changed.sequences,x.sequences);}finally{await a.exec('ROLLBACK');}}
 const target=`classid='pg_class'::regclass AND objid='public.synthetic_extension_table_identity_id_seq'::regclass
   AND refclassid='pg_class'::regclass AND deptype='i'`;
 const mutations=[
   `INSERT INTO pg_depend SELECT classid,objid,objsubid,refclassid,refobjid,refobjsubid,deptype FROM pg_depend WHERE ${target}`,
   `UPDATE pg_depend SET refobjsubid=32767 WHERE ${target}`,
   `UPDATE pg_depend SET objsubid=1 WHERE ${target}`,
   `UPDATE pg_depend SET deptype='n' WHERE ${target}`,
   `UPDATE pg_class SET relkind='r' WHERE oid='public.synthetic_extension_table_identity_id_seq'::regclass`,
   `DELETE FROM pg_sequence WHERE seqrelid='public.synthetic_extension_table_identity_id_seq'::regclass`,
   `UPDATE pg_attribute SET attisdropped=true WHERE attrelid='public.synthetic_extension_table'::regclass AND attnum=1`
 ];
 for(const sql of mutations){await a.exec('BEGIN');try{await a.exec(sql);assert.equal((await run(a)).ownershipOkay,false);}
   finally{await a.exec('ROLLBACK');}}
 const version=Number((await a.query('SHOW server_version_num')).rows[0].server_version_num);assert.notEqual(version,170006);
 process.stdout.write(JSON.stringify({actualVersion:version,shiftedOidsEqual:true,ownedSequences:2,
   definitionOwnerAclCommentMutations:4,malformedOwnershipRejected:mutations.length,native17Qualified:false})+'\n');
}catch(error){process.stderr.write(JSON.stringify({code:error.code,message:error.message})+'\n');process.exitCode=1;}
finally{await a.close();await b.close();}
"""
            result=subprocess.run(["node","--input-type=module","-",str(path)],input=script.encode(),cwd=ROOT,
                                  stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=45)
        self.assertEqual(result.returncode,0,result.stderr.decode())
        evidence=json.loads(result.stdout);self.assertTrue(evidence["shiftedOidsEqual"])
        self.assertEqual(evidence["ownedSequences"],2);self.assertEqual(evidence["malformedOwnershipRejected"],7)
        self.assertFalse(evidence["native17Qualified"])

    def test_full_merged_hook_query_keeps_actual_pg18_version_denied_with_documented_parser_only_shim(self):
        if shutil.which("node") is None or not (ROOT/"node_modules/@electric-sql/pglite").is_dir():
            self.skipTest("embedded-PG fixture unavailable; native17 remains unproved")
        def load(name):
            spec=importlib.util.spec_from_file_location(name,ROOT/"scripts/release"/(name+".py"))
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
        relations=load("extension-relation-payloads");hooks=load("extension-relation-query-hooks")
        merged={**p.MANIFESTS,**relations.MANIFESTS}
        actual=m.build_capture_all_private_wire_query(merged,**hooks.query_options(m,p,relations))
        self.assertIn('r."attcacheoff"',actual)
        self.assertIn("current_setting('server_version_num')::integer=170006",actual)
        # PG18 removed PG17's attcacheoff column, so a version CASE cannot
        # prevent parse-time 42703. This fixture substitutes a typed SQLNULL
        # solely to exercise parsing and actual18 denial of the remaining query.
        # Real PG17 generated SQL/manifests/version gate remain untouched.
        fixture=actual.replace('r."attcacheoff"',"NULL::integer")
        self.assertIn("current_setting('server_version_num')::integer=170006",fixture)
        with tempfile.TemporaryDirectory(prefix="synthetic-merged-denial-") as folder:
            path=Path(folder)/"parser-shim-only.sql";path.write_text(fixture)
            script=r"""
import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';
const db=await PGlite.create();try {
 await db.exec(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog; SET LOCAL kova.private_extension_wire='PRIVATE_GHA_CAPTURE_ONLY';`);
 const actual=Number((await db.query('SHOW server_version_num')).rows[0].server_version_num);
 assert.notEqual(actual,170006);
 const wire=JSON.parse(Object.values((await db.query(readFileSync(process.argv[2],'utf8'))).rows[0])[0]);
 assert.equal(wire.privateRawWire,false);assert.equal(wire.qualificationReady,false);
 assert.equal('rows' in wire,false);assert.equal('resolvedReferences' in wire,false);
 await db.exec('COMMIT');process.stdout.write(JSON.stringify({actualVersion:actual,denied:true,native17Qualified:false})+'\n');
} catch(error) {process.stderr.write(JSON.stringify({code:error.code,message:error.message})+'\n');process.exitCode=1;}
finally {await db.close();}
"""
            result=subprocess.run(["node","--input-type=module","-",str(path)],input=script.encode(),cwd=ROOT,
                                  stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=45)
        self.assertEqual(result.returncode,0,result.stderr.decode())
        evidence=json.loads(result.stdout);self.assertTrue(evidence["denied"])
        self.assertFalse(evidence["native17Qualified"])

    def test_embedded_sql_normalizes_shifted_oids_preserves_payload_changes_and_never_leaks_values(self):
        if shutil.which("node") is None or not (ROOT/"node_modules/@electric-sql/pglite").is_dir():
            self.skipTest("embedded-PG fixture unavailable; native17 remains unproved")
        script=r"""
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
const sql=readFileSync('scripts/release/extension-routine-type-payload-hashes.sql','utf8');
const alteredLayout=sql.replace("('pg_proc','prosrc','text',0,true)","('pg_proc','prosrc','name',0,true)");
const a=await PGlite.create(),b=await PGlite.create();
const query=async(db,text=sql)=>{
 const results=await db.exec(text), raw=results.find(x=>x.rows?.[0]?.jsonb_build_object).rows[0].jsonb_build_object;
 for(const canary of ['BODY_CANARY','CONFIG_CANARY','NODE_CANARY','LABEL_CANARY','hash_fixture','hash_reader'])
  assert.equal(raw.includes(canary),false,'source metadata escaped its hash boundary');
 return JSON.parse(raw);
};
const hash=(x,c)=>x.catalogPayloadHashes.find(v=>v.catalog===c).nonOpaquePayloadSha256;
const setup=`
CREATE ROLE hash_reader;
CREATE FUNCTION public.hash_fixture(x text DEFAULT 'NODE_CANARY') RETURNS text LANGUAGE sql
 SET custom.private_config='CONFIG_CANARY' AS 'SELECT $1 || ''BODY_CANARY''';
ALTER EXTENSION plpgsql ADD FUNCTION public.hash_fixture(text);
GRANT EXECUTE ON FUNCTION public.hash_fixture(text) TO hash_reader;
CREATE TYPE public.hash_enum AS ENUM ('LABEL_CANARY_A','LABEL_CANARY_B');
ALTER EXTENSION plpgsql ADD TYPE public.hash_enum;
CREATE FUNCTION public.hash_enum_default(x public.hash_enum DEFAULT 'LABEL_CANARY_A'::public.hash_enum)
 RETURNS public.hash_enum LANGUAGE sql AS 'SELECT $1';
ALTER EXTENSION plpgsql ADD FUNCTION public.hash_enum_default(public.hash_enum);
CREATE TYPE public.hash_range AS RANGE(subtype=integer);
ALTER EXTENSION plpgsql ADD TYPE public.hash_range;
CREATE AGGREGATE public.hash_sum(integer) (SFUNC=int4pl,STYPE=integer,INITCOND='0');
ALTER EXTENSION plpgsql ADD AGGREGATE public.hash_sum(integer);`;
try {
 await b.exec(`CREATE ROLE unrelated_shift; CREATE TYPE public.unrelated_shift AS ENUM ('irrelevant');`);
 await a.exec(setup);await b.exec(setup);
 const x=await query(a),y=await query(b);
 assert.notEqual(x.serverVersionNum,170006,'embedded runtime must not be presented as native17');
 assert.equal(x.scalarPayloadsComparable,false);assert.equal(x.qualificationReady,false);
 assert.equal(x.semanticEqualityProven,false);assert.equal(x.otherExtensionClassesCovered,false);
 assert.equal(x.guardResults.addresses_ok,true);assert.equal(x.guardResults.columns_ok,true);
 assert.equal(x.guardResults.foreign_keys_ok,true);assert.equal(x.guardResults.read_only_ok,true);
 assert.equal(x.guardResults.repeatable_read_ok,true);
 assert.deepEqual(x.catalogPayloadHashes,y.catalogPayloadHashes,'ordinary referenced OIDs were not normalized');
 assert.notEqual(x.rawNodeBindingSha256,y.rawNodeBindingSha256,'raw custom-enum node binding must retain its unnormalized OIDs');
 assert.equal(x.nodeCanonicalizationComplete,false);
 assert.ok(x.counts.uncanonicalizedOpaqueNodeOccurrences>=2);
 let before=x;
 await a.exec(`ALTER FUNCTION public.hash_fixture(text) SET custom.private_config='CONFIG_CANARY_CHANGED';`);
 let after=await query(a);assert.notEqual(hash(before,'pg_proc'),hash(after,'pg_proc'));before=after;
 await a.exec(`GRANT EXECUTE ON FUNCTION public.hash_fixture(text) TO hash_reader WITH GRANT OPTION;`);
 after=await query(a);assert.notEqual(hash(before,'pg_proc'),hash(after,'pg_proc'));before=after;
 await a.exec(`UPDATE pg_catalog.pg_proc SET proconfig=array_fill('custom.private_config=CONFIG_CANARY_CHANGED'::text,ARRAY[1],ARRAY[0]) WHERE oid='public.hash_fixture(text)'::regprocedure;`);
 after=await query(a);assert.notEqual(hash(before,'pg_proc'),hash(after,'pg_proc'));
 await a.exec(`UPDATE pg_catalog.pg_proc SET proconfig=NULL WHERE oid='public.hash_fixture(text)'::regprocedure;`);
 before=await query(a);
 await a.exec(`UPDATE pg_catalog.pg_proc SET proconfig=ARRAY[]::text[] WHERE oid='public.hash_fixture(text)'::regprocedure;`);
 after=await query(a);assert.notEqual(hash(before,'pg_proc'),hash(after,'pg_proc'));
 await a.exec(`UPDATE pg_catalog.pg_proc SET procost='-0'::real WHERE oid='public.hash_fixture(text)'::regprocedure;`);
 before=await query(a);
 await a.exec(`UPDATE pg_catalog.pg_proc SET procost='0'::real WHERE oid='public.hash_fixture(text)'::regprocedure;`);
 after=await query(a);assert.notEqual(hash(before,'pg_proc'),hash(after,'pg_proc'));
 before=after;await a.exec(`UPDATE pg_catalog.pg_aggregate SET agginitval='00' WHERE aggfnoid='public.hash_sum(integer)'::regprocedure;`);
 after=await query(a);assert.notEqual(hash(before,'pg_aggregate'),hash(after,'pg_aggregate'));
 const drift=await query(a,alteredLayout);assert.equal(drift.guardResults.columns_ok,false);
 assert.ok(drift.counts.catalogColumnDifferences>0);assert.equal(drift.scalarPayloadsComparable,false);
 await a.exec(`UPDATE pg_catalog.pg_proc SET prorettype=0 WHERE oid='public.hash_fixture(text)'::regprocedure;`);
 const invalid=await query(a);assert.equal(invalid.guardResults.references_ok,false);
 assert.ok(invalid.counts.invalidReferenceValues>0);assert.equal(invalid.scalarPayloadsComparable,false);
 process.stdout.write(JSON.stringify({embeddedServerVersionNum:x.serverVersionNum,nativePg17Qualified:false,
   crossServerOidNormalization:true,privateValuesWithheld:true,payloadMutationsDetected:true,
   opaqueTreesRemainUncanonicalized:true,unknownLayoutBlocked:true,mandatoryZeroReferenceBlocked:true})+'\n');
} finally {await a.close();await b.close();}
"""
        result=subprocess.run(["node","--input-type=module","-"],input=script.encode(),cwd=ROOT,
                              stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=90)
        self.assertEqual(result.returncode,0,result.stderr.decode())
        evidence=json.loads(result.stdout)
        self.assertFalse(evidence["nativePg17Qualified"])
        self.assertTrue(evidence["crossServerOidNormalization"])
        self.assertTrue(evidence["privateValuesWithheld"])


if __name__=="__main__":unittest.main()
