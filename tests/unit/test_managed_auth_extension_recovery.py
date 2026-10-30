"""Synthetic extension data and mocked operator; no live DB, customer rows or keys."""
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SCRIPT=Path(__file__).resolve().parents[2]/"scripts/release/managed-auth-recovery.py"
spec=importlib.util.spec_from_file_location("managed_auth_extension_recovery",SCRIPT)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def catalog():
    columns=[{"name":"label","typeSchema":"pg_catalog","typeName":"text","typeModifier":-1,
              "notNull":True,"identity":"","generated":"","defaultExpression":None,"collationSchema":"pg_catalog","collationName":"default"},
             {"name":"derived","typeSchema":"pg_catalog","typeName":"text","typeModifier":-1,
              "notNull":False,"identity":"","generated":"s","defaultExpression":"upper(label)","collationSchema":"pg_catalog","collationName":"default"}]
    return {"schemas":[{"name":n} for n in ["auth","public","storage","supabase_migrations"]],
            "tables":[{"schema":"auth","name":n,"kind":"r"} for n in ["users","identities","sessions"]]
                     +[{"schema":"extensions","name":"queue_metadata","kind":"r"}],
            "sequences":[{"schema":"extensions","name":"queue_sequence"}],
            "extensions":[{"name":"synthetic_extension"}],
            "extensionData":[{"schema":"extensions","name":"queue_metadata","kind":"r",
                              "extension":"synthetic_extension","columns":columns,"definition":{"owner":"postgres","sequence":None}},
                             {"schema":"extensions","name":"queue_sequence","kind":"S",
                              "extension":"synthetic_extension","columns":[],"definition":{"owner":"postgres","sequence":{"increment":"1"}}}]}


TOC="\n".join(f"{i}; 0 {i} TABLE DATA auth {n} postgres" for i,n in enumerate(["users","identities","sessions"],1))+"\n"


class ExtensionRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)

    def payload(self, raw=b"literal\\nline\\tfield\\\\backslash\n\\\\.\n\\N\n"):
        def query(_env,sql):
            return raw if "COPY (SELECT" in sql else b'{"value":"93","called":true}\n'
        with patch.object(m,"psql",side_effect=query):
            return m.capture_extension_data({},catalog(),"00000001-00000002-1")

    def test_extension_rows_and_sequences_share_the_exported_snapshot_and_exclude_generated_columns(self):
        calls=[]
        def query(_env,sql):
            calls.append(sql)
            return b"four preserved queue records\n" if "COPY (SELECT" in sql else b'{"value":"93","called":true}\n'
        with patch.object(m,"psql",side_effect=query):
            value=m.capture_extension_data({},catalog(),"00000001-00000002-1")
        self.assertEqual(len(calls),2)
        for sql in calls:
            self.assertIn("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",sql)
            self.assertIn("SET TRANSACTION SNAPSHOT '00000001-00000002-1'",sql)
        self.assertIn('COPY (SELECT "label" FROM ONLY "extensions"."queue_metadata")',calls[0])
        self.assertNotIn('"derived"',calls[0])
        self.assertEqual(value["tables"][0]["copyText"],"four preserved queue records\n")
        self.assertEqual(value["sequences"][0]["value"],"93")

    def test_dump_coverage_requires_every_extension_record_and_keeps_nonextension_tables_mandatory(self):
        entries=m.toc_entries(TOC);c=catalog();value=self.payload()
        with self.assertRaisesRegex(m.Stopped,"full_table_data_coverage_missing"):m.table_coverage(c,entries)
        m.table_coverage(c,entries,value)
        c["tables"].append({"schema":"public","name":"unregistered_user_table","kind":"r"})
        with self.assertRaisesRegex(m.Stopped,"full_table_data_coverage_missing"):m.table_coverage(c,entries,value)
        for key in ["tables","sequences"]:
            bad=copy.deepcopy(value);bad[key]=[]
            with self.subTest(key=key),self.assertRaisesRegex(m.Stopped,"extension_data_coverage_missing"):
                m.validate_extension_data(catalog(),bad)

    def test_registered_filtered_extension_data_is_replaced_once_without_duplication(self):
        entries=m.toc_entries(TOC+"4; 0 4 TABLE DATA extensions queue_metadata postgres\n5; 0 5 SEQUENCE SET extensions queue_sequence postgres\n")
        selected=m.data_restore_list(entries,{("extensions","queue_metadata")},{("extensions","queue_sequence")})
        self.assertNotIn(b"queue_metadata",selected);self.assertNotIn(b"queue_sequence",selected)
        for n in [b"users",b"identities",b"sessions"]:self.assertIn(n,selected)
        sql=m.extension_restore_sql(catalog(),self.payload())
        self.assertEqual(sql.count(b'COPY "extensions"."queue_metadata"'),1)
        self.assertEqual(sql.count(b"SELECT pg_catalog.setval('extensions.queue_sequence', 93, true);"),1)
        self.assertIn(b"\\\\.\n",sql)  # literal backslash-dot remains a data row.
        self.assertEqual(sql.count(b"\n\\.\n"),1)

    def test_unregistered_names_modified_data_or_copy_terminators_cannot_become_commands(self):
        good=self.payload()
        for mutate in [lambda d:d["tables"][0].update(schema="unregistered"),
                       lambda d:d["tables"][0].update(columns=['label"; DROP TABLE users;--']),
                       lambda d:d["tables"][0].update(copyText="changed private row\n"),
                       lambda d:d["sequences"][0].update(value="93); DROP TABLE users;--"),
                       lambda d:d["sequences"][0].update(called="true"),
                       lambda d:d["tables"].append(copy.deepcopy(d["tables"][0]))]:
            bad=copy.deepcopy(good);mutate(bad)
            with self.assertRaises(m.Stopped):m.extension_restore_sql(catalog(),bad)
        for raw in [b"unterminated row",b"\\.\n",b"\\.\r\n",b"\x00\n"]:
            with self.subTest(raw=repr(raw)),self.assertRaisesRegex(m.Stopped,"extension_copy_data_rejected"):
                self.payload(raw)

    def test_no_missing_extension_payload_or_unsupported_archive_member_is_accepted(self):
        for names,accepted in [(m.LEGACY_MEMBERS,True),(m.MEMBERS,True),
                               (m.MEMBERS|{"unreviewed.sql"},False),
                               (m.MEMBERS-{"extension-data.json","rows.json"},False)]:
            target=self.root/(str(len(names))+"-"+str(accepted)+".tar")
            with tarfile.open(target,"w") as archive:
                for name in names:
                    info=tarfile.TarInfo(name);info.size=1;archive.addfile(info,io.BytesIO(b"x"))
            out=self.root/(target.stem+"-out");out.mkdir()
            if accepted:m.bounded_archive(target,out)
            else:
                with self.assertRaisesRegex(m.Stopped,"backup_members_rejected"):m.bounded_archive(target,out)

    def test_size_and_deadline_guards_apply_to_supplemental_data(self):
        with patch.object(m,"STDOUT_BYTES",8):
            with self.assertRaises(m.Stopped):self.payload(b"more than eight bytes\n")
        with patch.object(m,"DEADLINE",0),patch.object(m.time,"monotonic",return_value=1):
            with self.assertRaisesRegex(m.Stopped,"operation_deadline_exceeded"):self.payload()

    def test_sequence_scanner_ignores_sql_looking_copy_data_and_requires_terminated_blocks(self):
        path=self.root/"synthetic-data.sql"
        path.write_bytes(b"COPY extensions.queue_metadata (label) FROM stdin;\n"
            b"SELECT pg_catalog.setval('extensions.queue_sequence', 999, true);\n"
            b"COPY extensions.other (label) FROM stdin;\n\\.\n"
            b"SELECT pg_catalog.setval('extensions.queue_sequence', 93, true);\n")
        self.assertEqual(m.data_sequence_values(path),[{"schema":"extensions","name":"queue_sequence","value":"93","called":True}])
        path.write_bytes(b"COPY extensions.queue_metadata (label) FROM stdin;\nunterminated\n")
        with self.assertRaisesRegex(m.Stopped,"copy_statement_unterminated"):m.data_sequence_values(path)

    def test_fresh_write_guard_refuses_expired_isolation_after_actual_identity_or_cron_read(self):
        for boundary in ["identity","cron"]:
            clock={"expired":False}
            def identity(*_args,**_kwargs):
                if boundary=="identity":clock["expired"]=True
            def query(*_args,**_kwargs):
                if boundary=="cron":clock["expired"]=True
                return b"off"
            def attest(_env):
                if clock["expired"]:raise m.Stopped("isolation_attestation_stale")
                return {"synthetic":True}
            with patch.object(m,"empty_target_identity",side_effect=identity),patch.object(m,"psql",side_effect=query),patch.object(m,"attest",side_effect=attest):
                with self.subTest(boundary=boundary),self.assertRaisesRegex(m.Stopped,"isolation_attestation_stale"):
                    m.restore_write_preflight({}, {}, {}, {"synthetic":True})


if __name__=="__main__":unittest.main()
