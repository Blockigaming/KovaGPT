"""Synthetic context/cleanup mutations; this unit suite never runs Docker."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT=Path(__file__).resolve().parents[2]/"scripts/release/smoke-generic-operator-archive-native.py"
spec=importlib.util.spec_from_file_location("generic_archive_native_test",SCRIPT)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class ArchiveNativeTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory();self.addCleanup(self.folder.cleanup)
        self.temp=Path(self.folder.name)
        self.env={"GITHUB_ACTIONS":"true","RUNNER_OS":"Linux","GITHUB_EVENT_NAME":"pull_request",
            "GITHUB_REPOSITORY":"Blockigaming/KovaGPT","GITHUB_REF":"refs/pull/123/merge",
            "GITHUB_SHA":"a"*40,"KOVA_SYNTHETIC_SOURCE_SHA":"a"*40,"GITHUB_RUN_ID":"12",
            "GITHUB_RUN_ATTEMPT":"1","RUNNER_TEMP":str(self.temp),
            "KOVA_SYNTHETIC_NATIVE_CONFIRMATION":"SYNTHETIC_ONLY","PATH":os.environ["PATH"]}

    def target(self):return m.paths(self.env)[4]/"receipt.json"

    def completed_fixture(self,instance):
        instance.output.mkdir(mode=0o700)
        for name in ["operator-client.oci.tar","client-image-inventory.json","image-preparation-receipt.json"]:
            (instance.output/name).write_bytes(b"SYNTHETIC fixture only")
        return {"format":2,"nativeOciArchiveRoundtripSmokePassed":True,"nativeToolSmokePassed":True,
            "localTagRemoved":True,"customerDataReceived":False,"sourceDatabaseConnected":False,
            "targetConnected":False,"restorePerformed":False,"futureRestoreApproved":False,
            "ociArchiveBytes":12,"ociArchiveSha256":"b"*64,"ociManifestDigest":"sha256:"+"c"*64,
            "clientImageId":"sha256:"+"d"*64,"buildClientImageId":"sha256:"+"e"*64,
            "ociRuntimeBindingSha256":"f"*64}

    def test_main_fork_unpinned_and_sensitive_contexts_stop_before_any_command(self):
        mutations=[("GITHUB_EVENT_NAME","workflow_dispatch"),("GITHUB_REF","refs/heads/main"),
            ("GITHUB_REPOSITORY","other/repo"),("KOVA_SYNTHETIC_SOURCE_SHA","b"*40),
            ("KOVA_PRODUCTION_DATABASE_URL","synthetic-private"),
            ("KOVA_PRODUCTION_BACKUP_PASSPHRASE","synthetic-private"),("OPENAI_API_KEY","synthetic-private")]
        for key,value in mutations:
            with self.subTest(key=key),patch.object(m.builder.Builder,"command") as command,\
                 self.assertRaises(m.synthetic.Stopped):
                m.NativeArchiveBuilder({**self.env,key:value},self.target().parent/"operator-client-image")
            command.assert_not_called()

    def test_production_constructor_still_rejects_genuine_pr_rehearsal_context(self):
        with self.assertRaises(m.builder.Stopped):m.builder.Builder(self.env,self.target().parent/"operator-client-image")

    def test_mocked_completed_path_deletes_archive_and_never_grants_production_authority(self):
        def execute(instance):return self.completed_fixture(instance)
        with patch.object(m.NativeArchiveBuilder,"execute",execute):value=m.rehearse(self.env,self.target())
        self.assertTrue(value["nativeOciArchiveRoundtripSmokePassed"])
        self.assertTrue(value["genericArchiveRemoved"])
        self.assertFalse((self.target().parent/"operator-client-image").exists())
        for key in ["productionArtifactPrepared","productionMutated","sourceConnected","customerRowsUsed",
                    "protectedPhraseUsed","restorePerformed","futureRestoreApproved","ociArchiveUploaded"]:
            self.assertIs(value[key],False)
        self.assertEqual(self.target().stat().st_mode & 0o777,0o600)

    def test_output_cannot_target_another_directory_or_overwrite_previous_attempt(self):
        with self.assertRaises(m.builder.Stopped):m.rehearse(self.env,self.temp/"foreign.json")
        self.target().parent.mkdir(mode=0o700)
        with self.assertRaises(m.builder.Stopped):m.rehearse(self.env,self.target())

    def test_changed_source_or_unknown_build_outcome_never_confirms_cleanup(self):
        def execute(instance):return self.completed_fixture(instance)
        with patch.object(m.NativeArchiveBuilder,"execute",execute):m.rehearse(self.env,self.target())
        file=self.target().parent/"owned.json";original=json.loads(file.read_text())
        changed={**original,"source":"b"*40};file.write_text(json.dumps(changed))
        with patch.object(m.builder.Builder,"command") as command,self.assertRaises(m.builder.Stopped):m.cleanup(self.env)
        command.assert_not_called()
        file.write_text(json.dumps({**original,"buildInvoked":True,"buildReturned":False}))
        with patch.object(m.builder.ram,"restore_from_state",return_value=[]),\
             patch.object(m.builder.Builder,"cleanup_image",return_value=True),\
             self.assertRaisesRegex(m.builder.Stopped,"cleanup_unconfirmed"):
            m.cleanup(self.env)


if __name__=="__main__":unittest.main()
