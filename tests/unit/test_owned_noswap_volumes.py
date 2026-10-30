"""Pure synthetic ownership/cleanup checks; never call Docker or mount anything."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/release/owned-noswap-volumes.py"
spec = importlib.util.spec_from_file_location("owned_ram_tests", SCRIPT)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
SOURCE = "a" * 40
OWNER = "b" * 10


def runtime_bytes(specs):
    rows=["C\t1001\t0000000000000000\t1\t0", "M\t1 0 0:1 / / ro - overlay overlay ro"]
    for i,spec in enumerate(specs,10):
        rows += ["M\t"+str(i)+" 1 0:"+str(i)+" / "+spec["destination"]+" rw,nosuid,nodev,noexec - tmpfs tmpfs rw,noswap",
            "S\t"+spec["destination"]+"\t"+" ".join(map(str,[spec["uid"],spec["gid"],spec["mode"].lstrip("0"),os.makedev(0,i),1])),
            "F\t"+spec["destination"]+"\t"+str(spec["size_mib"]*1024**2//4096)+" 4096 "+str(spec["nr_inodes"])]
    return ("\n".join(rows)+"\n").encode()


class FakeDocker:
    def __init__(self):
        self.volumes = {}; self.calls = []; self.references = b""; self.manager = None
        self.create_error = None; self.keep_removed = False; self.reservation_seen = False

    def __call__(self, argv, timeout=90):
        self.calls.append(copy.deepcopy(argv))
        if argv[:3] == ["docker", "volume", "ls"]:
            return b"".join(m.encoded({"Name": name, "Driver": value["Driver"]}) for name, value in self.volumes.items())
        if argv[:3] == ["docker", "volume", "create"]:
            manager = self.manager() if callable(self.manager) else self.manager
            state = m.private_state(manager.state_path)
            self.reservation_seen = any(row["create_pending"] is True for row in state["specs"].values())
            if self.create_error is not None: raise self.create_error
            options = {}; labels = {}
            for i, value in enumerate(argv[:-1]):
                if value in {"--opt", "--label"}:
                    key, item = argv[i + 1].split("=", 1)
                    (options if value == "--opt" else labels)[key] = item
            name = argv[-1]
            self.volumes[name] = {"Name": name, "Driver": "local", "Scope": "local", "Options": options,
                                  "Labels": labels, "Mountpoint": "/synthetic/docker/volumes/" + name + "/_data"}
            return (name + "\n").encode()
        if argv[:3] == ["docker", "volume", "inspect"]:
            return m.encoded([self.volumes[argv[-1]]])
        if argv[:2] == ["docker", "ps"]: return self.references
        if argv[:3] == ["docker", "volume", "rm"]:
            assert len(argv) == 4 and "--force" not in argv and "-f" not in argv
            if not self.keep_removed: del self.volumes[argv[-1]]
            return (argv[-1] + "\n").encode()
        raise AssertionError("unexpected synthetic command")


class OwnedVolumeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(); self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name); self.docker = FakeDocker()
        self.manager = m.OwnedVolumes(SOURCE, OWNER, "123", "1", self.root, self.docker)
        self.docker.manager = self.manager
        self.env = {"GITHUB_SHA": SOURCE, "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1", "RUNNER_TEMP": str(self.root)}

    def create(self):
        self.manager.ensure("work", "/work", 128, 1001, 1001, "0700")
        return self.manager.specs["work"]

    def runtime(self, spec=None):
        spec = spec or self.manager.specs["work"]
        return {"name": spec["name"], "device": "0:123", "root": "/",
                "hostmountpoint": spec["mountpoint"], "destination": spec["destination"]}

    def restored(self):
        called = []
        values = m.restore_from_state(self.env, context_validator=lambda env: called.append(env), command=self.docker)
        self.assertEqual(called, [self.env])
        return values

    def test_create_is_reserved_privately_before_exact_local_tmpfs_recipe(self):
        mount = self.manager.ensure("work", "/work", 128, 1001, 1001, "0700")
        spec = self.manager.specs["work"]
        self.assertTrue(self.docker.reservation_seen)
        self.assertEqual(self.manager.state_path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(mount, "type=volume,src=" + spec["name"] + ",dst=/work,volume-nocopy")
        self.assertEqual(spec["options"], {"type": "tmpfs", "device": "tmpfs",
            "o": "rw,nosuid,nodev,noexec,noswap,size=128m,uid=1001,gid=1001,mode=0700,nr_inodes=131072"})
        self.assertEqual(self.docker.calls[0], ["docker", "volume", "ls", "--format", "{{json .}}"])
        self.assertEqual(spec["phase"], "created"); self.assertFalse(spec["create_pending"])
        self.assertFalse(spec["activated"]); self.assertEqual(spec["runtime"], [])
        self.assertEqual(self.docker.volumes[spec["name"]]["Labels"], self.manager.labels)
        self.assertNotIn("runtimeVerified", spec)

    def test_spec_and_mount_views_are_copies_and_reuse_rechecks_exact_identity(self):
        self.create(); exposed = self.manager.specs; exposed["work"]["options"]["device"] = "/host"
        self.assertEqual(self.manager.specs["work"]["options"]["device"], "tmpfs")
        expected = self.manager.expected_mounts(["work"]); expected[0]["destination"] = "/other"
        self.assertEqual(self.manager.specs["work"]["destination"], "/work")
        self.manager.ensure("work", "/work", 128, 1001, 1001, "0700")
        self.assertEqual(sum(c[:3] == ["docker", "volume", "create"] for c in self.docker.calls), 1)
        for change in [("/other", 128, 1001, 1001, "0700"), ("/work", 256, 1001, 1001, "0700")]:
            with self.subTest(change=change), self.assertRaises(m.Stopped): self.manager.ensure("work", *change)

    def test_foreign_existing_name_is_never_reserved_or_modified(self):
        desired = self.manager._spec("work", "/work", 128, 1001, 1001, "0700")
        self.docker.volumes[desired["name"]] = {"Driver": "local"}
        with self.assertRaisesRegex(m.Stopped, "name_not_absent"): self.create()
        self.assertEqual(len(self.docker.calls), 1); self.assertFalse(self.manager.state_path.exists())

    def test_unsafe_destinations_modes_ids_and_sizes_fail_before_any_command(self):
        for destination in ["/", "/proc", "/proc/a", "/sys/a", "/dev/shm", "/run/client", "/run/client/x",
                            "/work/../other", "/work//a", "/work,a", "/work.sock", "relative", "/work\n"]:
            with self.subTest(destination=destination), self.assertRaises(m.Stopped):
                self.manager.ensure("work", destination, 128, 1001, 1001, "0700")
        for size, uid, gid, mode in [(0, 1, 1, "0700"), (32769, 1, 1, "0700"), (True, 1, 1, "0700"),
                                    (128, -1, 1, "0700"), (128, 1, True, "0700"), (128, 1, 1, "0777"),
                                    (128, 1, 1, "1777")]:
            with self.subTest(values=(size, uid, gid, mode)), self.assertRaises(m.Stopped):
                self.manager.ensure("work", "/work", size, uid, gid, mode)
        self.assertFalse(self.docker.calls)

    def test_unknown_create_outcome_is_not_waived_by_later_empty_census_or_retry(self):
        self.docker.create_error = RuntimeError("SYNTHETIC_PRIVATE_EXCEPTION")
        with self.assertRaisesRegex(m.Stopped, "command_unconfirmed") as caught: self.create()
        self.assertNotIn("SYNTHETIC_PRIVATE_EXCEPTION", str(caught.exception))
        self.assertTrue(self.manager.specs["work"]["create_pending"])
        calls = len(self.docker.calls)
        with self.assertRaisesRegex(m.Stopped, "creation_outcome_unknown"): self.manager.cleanup()
        self.assertEqual(len(self.docker.calls), calls)
        with self.assertRaisesRegex(m.Stopped, "existing_plan_unqualified"): self.create()
        restored = self.restored(); self.assertEqual(len(restored), 1)
        with self.assertRaisesRegex(m.Stopped, "creation_outcome_unknown"): restored[0].cleanup()

    def test_known_completed_create_failure_can_prove_absence_without_force(self):
        error = RuntimeError("SYNTHETIC_PRIVATE_EXCEPTION"); error.completed = True
        self.docker.create_error = error
        with self.assertRaises(m.Stopped): self.create()
        self.assertFalse(self.manager.specs["work"]["create_pending"])
        self.assertTrue(self.manager.cleanup())
        self.assertFalse(any(c[:3] == ["docker", "volume", "rm"] for c in self.docker.calls))

    def test_inspection_rejects_foreign_labels_driver_scope_options_and_mountpoint(self):
        spec = self.create(); original = copy.deepcopy(self.docker.volumes[spec["name"]])
        for key, value in [("Name", "foreign"), ("Driver", "foreign-plugin"), ("Scope", "global"),
                           ("Labels", {}), ("Labels", {**self.manager.labels, "extra": "foreign"}),
                           ("Options", {}), ("Options", {**spec["options"], "device": "/host"}),
                           ("Mountpoint", "/synthetic/foreign"),
                           ("Mountpoint", "/synthetic/../docker/volumes/" + spec["name"] + "/_data")]:
            self.docker.volumes[spec["name"]] = {**original, key: value}
            with self.subTest(key=key, value=value), self.assertRaises(m.Stopped): self.manager.verify()
            with self.assertRaises(m.Stopped): self.manager.cleanup()
        self.assertFalse(any(c[:3] == ["docker", "volume", "rm"] for c in self.docker.calls))

    def test_container_mount_validation_rejects_anonymous_ordinary_or_unexpected_mounts(self):
        spec = self.create()
        actual = {"Type": "volume", "Name": spec["name"], "Source": spec["mountpoint"], "Driver": "local",
                  "RW": True, "Destination": "/work", "Propagation": ""}
        self.assertTrue(m.verify_inspected_mount(spec, actual))
        self.assertTrue(self.manager.verify_container_mounts([actual], ["work"]))
        for key, value in [("Type", "bind"), ("Name", "anonymous"), ("Source", "/host"),
                           ("Driver", "other"), ("RW", False), ("RW", 1), ("Destination", "/other"),
                           ("Propagation", "shared")]:
            with self.subTest(key=key), self.assertRaises(m.Stopped): m.verify_inspected_mount(spec, {**actual, key: value})
        for rows in [[], [actual, {**actual, "Name": "ordinary-volume"}], [actual, actual]]:
            with self.assertRaises(m.Stopped): self.manager.verify_container_mounts(rows, ["work"])

    def test_runtime_proof_requires_prior_activation_exact_owned_identity_and_is_persisted(self):
        spec = self.create(); row = self.runtime(spec)
        with self.assertRaisesRegex(m.Stopped, "runtime_identity"): self.manager.record_runtime_proof([row])
        self.manager.record_activation(["work"])
        self.manager.record_runtime_proof([row])
        self.assertEqual(self.manager.runtime_records, [row]); self.assertEqual(self.restored()[0].runtime_records, [row])
        self.manager.record_runtime_proof([row])
        exposed = self.manager.runtime_records; exposed[0]["device"] = "0:999"
        self.assertEqual(self.manager.runtime_records[0]["device"], "0:123")
        for key, value in [("name", "foreign"), ("device", "0:999"), ("root", "/subdirectory"),
                           ("hostmountpoint", "/host"), ("destination", "/other")]:
            with self.subTest(key=key), self.assertRaises(m.Stopped): self.manager.record_runtime_proof([{**row, key: value}])
        with self.assertRaises(m.Stopped): self.manager.record_runtime_proof([row, row])

    def test_activated_volume_without_kernel_record_is_quarantined_before_cleanup(self):
        self.create(); self.manager.record_activation(["work"])
        before = len(self.docker.calls)
        with self.assertRaisesRegex(m.Stopped, "activated_runtime_unconfirmed"): self.manager.cleanup()
        self.assertEqual(len(self.docker.calls), before)
        with self.assertRaisesRegex(m.Stopped, "activated_runtime_unconfirmed"): self.restored()[0].cleanup()

    def test_cleanup_checks_all_container_refs_and_nonforced_removal_then_full_census(self):
        spec = self.create(); self.manager.record_activation(["work"]); self.manager.record_runtime_proof([self.runtime(spec)])
        self.docker.references = b'{"Names":"synthetic-stopped-container"}\n'
        with self.assertRaisesRegex(m.Stopped, "container_references_present"): self.manager.cleanup()
        self.assertFalse(any(c[:3] == ["docker", "volume", "rm"] for c in self.docker.calls))
        self.docker.references = b""
        self.assertTrue(self.manager.cleanup())
        self.assertIn(["docker", "ps", "--all", "--filter", "volume=" + spec["name"], "--format", "{{json .}}"], self.docker.calls)
        self.assertIn(["docker", "volume", "rm", spec["name"]], self.docker.calls)
        self.assertEqual(self.docker.calls[-1], ["docker", "volume", "ls", "--format", "{{json .}}"])
        # Docker metadata absence is not a namespace/noswap-cleanup receipt.
        self.assertEqual(self.manager.runtime_records, [self.runtime(spec)])

    def test_absent_volume_still_requires_complete_container_reference_census(self):
        spec = self.create(); del self.docker.volumes[spec["name"]]
        self.docker.references = b'{"Names":"synthetic-existing-container"}\n'
        with self.assertRaisesRegex(m.Stopped, "container_references_present"): self.manager.cleanup()
        self.docker.references = b""
        self.assertTrue(self.manager.cleanup())
        self.assertFalse(any(c[:3] == ["docker", "volume", "rm"] for c in self.docker.calls))

    def test_cleanup_census_does_not_assume_a_successful_rm_proves_absence(self):
        self.create(); self.docker.keep_removed = True
        with self.assertRaisesRegex(m.Stopped, "removal_unconfirmed"): self.manager.cleanup()

    def test_census_output_and_command_errors_fail_closed(self):
        for raw in [b'not json', b'{"Name":"one"}\n{"Name":"one"}\n', b'{"Name":"../foreign"}\n', b'[]']:
            manager = m.OwnedVolumes(SOURCE, "c" * 10, "123", "1", self.root, lambda *a, **k: raw)
            with self.subTest(raw=raw), self.assertRaises(m.Stopped): manager.ensure("work", "/work", 128, 1, 1, "0700")
        manager = m.OwnedVolumes(SOURCE, "d" * 10, "123", "1", self.root, lambda *a, **k: "not bytes")
        with self.assertRaises(m.Stopped): manager.ensure("work", "/work", 128, 1, 1, "0700")

    def test_missing_relative_or_root_temporary_directory_never_adopts_current_workdir(self):
        for directory in ["", ".", "relative", "/"]:
            with self.subTest(directory=directory), self.assertRaises(m.Stopped):
                m.restore_from_state({**self.env, "RUNNER_TEMP": directory}, context_validator=lambda env: None, command=self.docker)
        with self.assertRaises(m.Stopped): m.OwnedVolumes(SOURCE, OWNER, "123", "1", ".", self.docker)
        self.assertFalse(self.docker.calls)

    def test_backstop_is_pure_and_only_current_context_identity_may_be_adopted(self):
        self.create(); self.docker.calls.clear()
        values = self.restored(); self.assertEqual(values[0].specs, self.manager.specs)
        self.assertFalse(self.docker.calls)
        with self.assertRaises(RuntimeError):
            m.restore_from_state(self.env, context_validator=lambda env: (_ for _ in ()).throw(RuntimeError()), command=self.docker)
        for key, value in [("source", "f" * 40), ("owner", "f" * 10), ("runId", "999"), ("attempt", "2"), ("uid", -1)]:
            original = m.private_state(self.manager.state_path)
            changed = {**original, key: value}; self.manager.state_path.write_bytes(m.encoded(changed))
            with self.subTest(key=key), self.assertRaises(m.Stopped): self.restored()
            self.manager.state_path.write_bytes(m.encoded(original))
        self.assertFalse(self.docker.calls)

    def test_backstop_rejects_weakened_recipe_extra_fields_and_forged_runtime(self):
        self.create(); original = m.private_state(self.manager.state_path)
        variants = []
        changed = copy.deepcopy(original); changed["specs"]["work"]["options"]["o"] = "rw"; variants.append(changed)
        changed = copy.deepcopy(original); changed["extra"] = True; variants.append(changed)
        changed = copy.deepcopy(original); changed["specs"]["work"]["create_pending"] = "false"; variants.append(changed)
        changed = copy.deepcopy(original); changed["specs"]["work"]["runtime"] = [self.runtime()]; variants.append(changed)
        changed = copy.deepcopy(original); changed["specs"]["work"]["mountpoint"] = "/foreign"; variants.append(changed)
        for value in variants:
            self.manager.state_path.write_bytes(m.encoded(value))
            with self.subTest(value=value), self.assertRaises(m.Stopped): self.restored()
        self.manager.state_path.write_bytes(m.encoded(original))

    def test_backstop_rejects_public_state_symlink_and_duplicate_json(self):
        self.create(); raw = self.manager.state_path.read_bytes()
        self.manager.state_path.chmod(0o644)
        with self.assertRaises(m.Stopped): self.restored()
        self.manager.state_path.chmod(0o600)
        self.manager.state_path.write_bytes(b'{"format":1,"format":1}')
        with self.assertRaises(m.Stopped): self.restored()
        self.manager.state_path.write_bytes(raw)
        saved = self.root / "saved.json"; self.manager.state_path.rename(saved); self.manager.state_path.symlink_to(saved)
        with self.assertRaises(m.Stopped): self.restored()


if __name__ == "__main__": unittest.main()
