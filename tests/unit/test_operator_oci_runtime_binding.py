"""Pure synthetic format-conversion mutations; no Docker or recovery authority."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

SCRIPT=Path(__file__).resolve().parents[2]/"scripts/release/prepare-recovery-operator-image.py"
spec=importlib.util.spec_from_file_location("oci_runtime_binding_under_test",SCRIPT)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def fixture():
    config={"User":"65532:65532","Env":["PATH=/usr/bin","LANG=C.UTF-8"],
        "Entrypoint":["python3","/opt/kova/scripts/release/recovery-operator-client-smoke.py"],
        "Cmd":None,"WorkingDir":"/tmp","Volumes":None,"ExposedPorts":None,
        "Labels":{"org.opencontainers.image.revision":"a"*40,"org.kova.recovery.owner":"b"*24},
        "Healthcheck":{"Test":["NONE"]},"Shell":["/bin/bash","-o","pipefail","-c"],"OnBuild":None,
        "Hostname":"","Domainname":"","AttachStdin":False,"AttachStdout":False,
        "AttachStderr":False,"Tty":False,"OpenStdin":False,"StdinOnce":False,"Image":""}
    image={"Architecture":"amd64","Os":"linux","Config":config,
        "RootFS":{"Type":"layers","Layers":["sha256:"+"c"*64]}}
    converted={"architecture":"amd64","os":"linux","config":{k:copy.deepcopy(v)
        for k,v in config.items() if k in m.OCI_RUNTIME_KEYS and v not in (None,[],{},False,"")},
        "rootfs":{"type":"layers","diff_ids":["sha256:"+"c"*64]},
        "history":[{"created_by":"SYNTHETIC fixture only","empty_layer":True}]}
    return image,converted


class RuntimeBindingTests(unittest.TestCase):
    def test_only_absent_or_explicitly_disabled_image_healthchecks_are_accepted(self):
        self.assertTrue(m.image_healthcheck_disabled({}))
        self.assertTrue(m.image_healthcheck_disabled({"Healthcheck":{"Test":["NONE"]}}))
        for health in [None,{}, {"Test":["CMD","unexpected"]},{"Test":["NONE"],"futureHook":True},
                       {"Test":["NONE"],"Interval":1},{"Test":["NONE","CMD"]}]:
            with self.subTest(health=health):self.assertFalse(m.image_healthcheck_disabled({"Healthcheck":health}))

    def binding(self,built,converted):
        return m.verify_oci_runtime_binding(built,converted,source_sha="a"*40,owner="b"*24)

    def test_real_format_rules_allow_changed_json_digest_only_with_identical_runtime_and_layers(self):
        built,converted=fixture()
        original=m.sha(json.dumps(built["Config"]).encode());transported=m.sha(json.dumps(converted["config"]).encode())
        self.assertNotEqual(original,transported)
        value=self.binding(built,converted)
        self.assertTrue(value["allRuntimeFieldsPreserved"]);self.assertTrue(value["allRootfsDiffIdsPreserved"])
        self.assertFalse(value["configurationRewrittenLocally"])

    def test_changed_runtime_values_never_qualify(self):
        for key,value in [("User","0"),("WorkingDir","/other"),("Env",["PATH=/private"]),
                          ("Entrypoint",["/bin/sh"]),("Cmd",["unexpected"]),("ArgsEscaped",True),
                          ("Volumes",{"/private":{}}),("ExposedPorts",{"8000/tcp":{}})]:
            built,converted=fixture();converted["config"][key]=value
            with self.subTest(key=key),self.assertRaises(m.Stopped):self.binding(built,converted)

    def test_missing_or_foreign_source_and_owner_labels_never_qualify(self):
        for key in ["org.opencontainers.image.revision","org.kova.recovery.owner"]:
            built,converted=fixture();converted["config"]["Labels"].pop(key)
            with self.subTest(key=key),self.assertRaises(m.Stopped):self.binding(built,converted)
        built,converted=fixture();built["Config"]["Labels"]["org.kova.recovery.owner"]="foreign"
        converted["config"]["Labels"]["org.kova.recovery.owner"]="foreign"
        with self.assertRaises(m.Stopped):self.binding(built,converted)

    def test_unsupported_dropped_hooks_and_unknown_fields_never_qualify(self):
        for key,value in [("Healthcheck",{"Test":["CMD","private-command"]}),
                          ("Shell",["/unexpected-shell"]),("OnBuild",["RUN unexpected"]),
                          ("Tty",True),("UnknownRuntimeField",False)]:
            built,converted=fixture();built["Config"][key]=value
            with self.subTest(key=key),self.assertRaises(m.Stopped):self.binding(built,converted)
        built,converted=fixture();converted["config"]["Healthcheck"]={"Test":["NONE"]}
        with self.assertRaises(m.Stopped):self.binding(built,converted)

    def test_changed_filesystem_or_architecture_never_qualifies(self):
        for alter in [lambda v:v["rootfs"]["diff_ids"].append("sha256:"+"d"*64),
                      lambda v:v.update(architecture="arm64"),lambda v:v.update(os="windows"),
                      lambda v:v["rootfs"].update(type="unexpected")]:
            built,converted=fixture();alter(converted)
            with self.subTest(alter=alter),self.assertRaises(m.Stopped):self.binding(built,converted)

    def test_unknown_oci_fields_and_typed_null_runtime_values_are_rejected(self):
        for alter in [lambda v:v.update(unknown="private-value"),
                      lambda v:v["config"].update(Cmd=None),lambda v:v["config"].update(Labels=[]),
                      lambda v:v["config"].update(ArgsEscaped=0)]:
            built,converted=fixture();alter(converted)
            with self.subTest(alter=alter),self.assertRaises(m.Stopped):self.binding(built,converted)


if __name__=="__main__":unittest.main()
