#!/usr/bin/env python3
"""Own exact Docker local tmpfs volumes; creation is never a runtime proof.

The caller must separately prove effective tmpfs/noswap and container isolation.
Cleanup establishes only exact owned Docker resource absence. This module never mounts a host directory,
reads customer data, follows a production URL or weakens a container policy.
"""
import copy
import json
import os
from pathlib import Path
import re
import stat

MAX_STATE = 1024 * 1024
MAX_COMMAND = 8 * 1024 * 1024
LABEL_PREFIX = "kova.ram-volume."


class Stopped(Exception): pass


def require(ok, code):
    if not ok: raise Stopped(code)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def strict_json(raw):
    def pairs(rows):
        value = {}
        for key, item in rows:
            require(key not in value, "owned_volume_duplicate_json_key")
            value[key] = item
        return value
    try: return json.loads(raw, object_pairs_hook=pairs)
    except (ValueError, TypeError): raise Stopped("owned_volume_json_unqualified") from None


def safe_path(value):
    return (type(value) is str and value.startswith("/") and value != "/"
            and len(value) <= 4096 and re.fullmatch(r"/[A-Za-z0-9_./-]+", value) is not None
            and not any(part in {"", ".", ".."} for part in value.split("/")[1:]))


def identity(source, owner, run_id, attempt):
    require(type(source) is str and re.fullmatch(r"[a-f0-9]{40}", source)
            and type(owner) is str and re.fullmatch(r"(?:[a-f0-9]{10}|[a-f0-9]{24})", owner)
            and type(run_id) is str and re.fullmatch(r"[1-9][0-9]{0,19}", run_id)
            and type(attempt) is str and re.fullmatch(r"[1-9][0-9]{0,11}", attempt),
            "owned_volume_identity_unqualified")


def mountpoint(value, name):
    return safe_path(value) and Path(value).parts[-3:] == ("volumes", name, "_data")


def private_state(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
            and not info.st_mode & 0o077 and 0 < info.st_size <= MAX_STATE,
            "owned_volume_state_private_required")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        actual = os.fstat(fd)
        require((info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_size) ==
                (actual.st_dev, actual.st_ino, actual.st_mode, actual.st_uid, actual.st_size),
                "owned_volume_state_changed")
        raw = os.read(fd, MAX_STATE + 1)
        require(len(raw) == info.st_size, "owned_volume_state_changed")
        return strict_json(raw)
    finally: os.close(fd)


def verify_inspected_mount(spec, actual_mount):
    """Inspect only: effective kernel filesystem proof remains mandatory."""
    require(type(actual_mount) is dict and type(spec) is dict
            and spec.get("phase") == "created" and mountpoint(spec.get("mountpoint"), spec.get("name"))
            and actual_mount.get("Type") == "volume" and actual_mount.get("Name") == spec["name"]
            and actual_mount.get("Source") == spec["mountpoint"]
            and actual_mount.get("Driver") == "local" and actual_mount.get("RW") is True
            and actual_mount.get("Destination") == spec["destination"]
            and actual_mount.get("Propagation", "") == "", "owned_volume_container_mount_unqualified")
    return True


class OwnedVolumes:
    def __init__(self, source, owner, run_id, attempt, runner_temp, command):
        identity(source, owner, run_id, attempt)
        self.source, self.owner, self.run_id, self.attempt = source, owner, run_id, attempt
        require(Path(runner_temp).is_absolute(), "owned_volume_context_unqualified")
        self.runner_temp = Path(runner_temp).resolve()
        require(self.runner_temp.is_dir() and self.runner_temp != Path("/") and callable(command),
                "owned_volume_context_unqualified")
        self.command = command
        self.state_path = self.runner_temp / ("kova-ram-volumes-" + run_id + "-" + attempt + "-" + owner + ".json")
        require(not self.state_path.exists() and not self.state_path.is_symlink(), "owned_volume_attempt_reserved")
        self._specs = {}

    @property
    def specs(self): return copy.deepcopy(self._specs)

    @property
    def labels(self):
        return {LABEL_PREFIX + "owner": self.owner, LABEL_PREFIX + "source": self.source,
                LABEL_PREFIX + "run": self.run_id, LABEL_PREFIX + "attempt": self.attempt}

    def _run(self, argv, timeout=90):
        try: raw = self.command(argv, timeout=timeout)
        except Exception as error:
            stopped = Stopped("owned_volume_command_unconfirmed")
            stopped.completed = getattr(error, "completed", False) is True
            raise stopped from None
        require(type(raw) is bytes and len(raw) <= MAX_COMMAND, "owned_volume_command_output_unqualified")
        return raw

    def _spec(self, key, destination, size_mib, uid, gid, mode):
        require(type(key) is str and re.fullmatch(r"[a-z][a-z0-9_-]{0,31}", key)
                and safe_path(destination) and not any(destination == p or destination.startswith(p + "/")
                    for p in ["/proc", "/sys", "/dev", "/run/client"])
                and not destination.endswith(".sock")
                and type(size_mib) is int and 64 <= size_mib <= 32768
                and all(type(v) is int and 0 <= v <= 2147483647 for v in [uid, gid]),
                "owned_volume_recipe_unqualified")
        if type(mode) is int: mode = format(mode, "04o")
        require(mode == ("1777" if destination == "/tmp" else "0700"), "owned_volume_mode_unqualified")
        inodes = max(4096, min(1048576, size_mib * 1024))
        name = "kova-ram-" + self.run_id + "-" + self.attempt + "-" + self.owner + "-" + key
        options = {"type": "tmpfs", "device": "tmpfs", "o": "rw,nosuid,nodev,noexec,noswap,size=" + str(size_mib)
                   + "m,uid=" + str(uid) + ",gid=" + str(gid) + ",mode=" + mode + ",nr_inodes=" + str(inodes)}
        return {"key": key, "name": name, "destination": destination, "size_mib": size_mib,
                "uid": uid, "gid": gid, "mode": mode, "nr_inodes": inodes, "driver": "local",
                "scope": "local", "device": "tmpfs", "options": options, "phase": "planned", "mountpoint": None,
                "create_pending": False, "activated": False, "runtime": []}

    def _state(self):
        return {"format": 1, "source": self.source, "owner": self.owner, "runId": self.run_id,
                "attempt": self.attempt, "uid": os.getuid(), "specs": self._specs}

    def _save(self):
        if self.state_path.exists():
            old = private_state(self.state_path)
            require(all(old.get(k) == self._state()[k] for k in ["format", "source", "owner", "runId", "attempt", "uid"]),
                    "owned_volume_state_identity_changed")
        raw = encoded(self._state()); require(len(raw) <= MAX_STATE, "owned_volume_state_bound")
        temporary = self.state_path.with_name(self.state_path.name + ".new")
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(fd, "wb") as target:
                os.fchmod(target.fileno(), 0o600)
                target.write(raw); target.flush(); os.fsync(target.fileno())
            os.replace(temporary, self.state_path)
        except Exception:
            if temporary.exists(): temporary.unlink()
            raise

    def _census(self):
        raw = self._run(["docker", "volume", "ls", "--format", "{{json .}}"])
        rows = [strict_json(line) for line in raw.splitlines() if line.strip()]
        names = [row.get("Name") if type(row) is dict else None for row in rows]
        require(all(type(name) is str and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,255}", name) for name in names)
                and len(names) == len(set(names)), "owned_volume_census_unqualified")
        return set(names)

    def _inspect(self, spec):
        rows = strict_json(self._run(["docker", "volume", "inspect", spec["name"]]))
        require(type(rows) is list and len(rows) == 1 and type(rows[0]) is dict, "owned_volume_inspect_unqualified")
        actual = rows[0]
        require(actual.get("Name") == spec["name"] and actual.get("Driver") == "local"
                and actual.get("Scope") == "local" and actual.get("Options") == spec["options"]
                and actual.get("Labels") == self.labels and mountpoint(actual.get("Mountpoint"), spec["name"])
                and (spec["mountpoint"] is None or actual["Mountpoint"] == spec["mountpoint"]),
                "owned_volume_configuration_changed")
        return actual

    def ensure(self, key, destination, size_mib, uid, gid, mode):
        desired = self._spec(key, destination, size_mib, uid, gid, mode)
        if key in self._specs:
            existing = self._specs[key]
            require({k: v for k, v in existing.items() if k not in {"phase", "mountpoint", "create_pending", "activated", "runtime"}} ==
                    {k: v for k, v in desired.items() if k not in {"phase", "mountpoint", "create_pending", "activated", "runtime"}}
                    and existing["phase"] == "created" and existing["create_pending"] is False, "owned_volume_existing_plan_unqualified")
            self._inspect(existing)
        else:
            require(len(self._specs) < 64 and desired["name"] not in self._census(), "owned_volume_name_not_absent")
            desired["create_pending"] = True
            self._specs[key] = desired; self._save()  # Reserve BEFORE attempting create.
            args = ["docker", "volume", "create", "--driver", "local"]
            for label, value in sorted(self.labels.items()): args += ["--label", label + "=" + value]
            for option, value in desired["options"].items(): args += ["--opt", option + "=" + value]
            args += [desired["name"]]
            try: result = self._run(args)
            except Stopped as error:
                if getattr(error, "completed", False) is True: self._complete_create(desired)
                raise
            self._complete_create(desired)
            require(result.decode("ascii", errors="replace").strip() == desired["name"], "owned_volume_create_unconfirmed")
            observed = self._inspect(desired)
            desired.update(phase="created", mountpoint=observed["Mountpoint"]); self._save()
        return "type=volume,src=" + desired["name"] + ",dst=" + destination + ",volume-nocopy"

    def _complete_create(self, spec):
        spec["create_pending"] = False
        try: self._save()
        except Exception:
            spec["create_pending"] = True
            raise

    def record_activation(self, keys):
        for spec in self.expected_mounts(keys):
            require(spec["phase"] == "created" and spec["create_pending"] is False,
                    "owned_volume_creation_unconfirmed")
            self._specs[spec["key"]]["activated"] = True
        self._save()

    @property
    def runtime_records(self):
        return copy.deepcopy([row for spec in self._specs.values() for row in spec["runtime"]])

    def record_runtime_proof(self, records):
        require(type(records) is list and 0 < len(records) <= 64, "owned_volume_runtime_shape_unqualified")
        by_name = {spec["name"]: spec for spec in self._specs.values()}
        seen = set()
        for row in records:
            require(type(row) is dict and set(row) == {"name", "device", "root", "hostmountpoint", "destination"}
                    and row.get("name") in by_name and row["name"] not in seen,
                    "owned_volume_runtime_shape_unqualified")
            spec = by_name[row["name"]]; seen.add(row["name"])
            require(spec["phase"] == "created" and spec["create_pending"] is False and spec["activated"] is True
                    and row["hostmountpoint"] == spec["mountpoint"] and row["destination"] == spec["destination"]
                    and row["root"] == "/" and type(row["device"]) is str
                    and re.fullmatch(r"[0-9]{1,10}:[0-9]{1,10}", row["device"])
                    and (not spec["runtime"] or spec["runtime"] == [row]), "owned_volume_runtime_identity_changed")
        for row in records: by_name[row["name"]]["runtime"] = [copy.deepcopy(row)]
        self._save()

    def expected_mounts(self, keys):
        require(type(keys) in {list, tuple} and len(keys) == len(set(keys))
                and all(key in self._specs for key in keys), "owned_volume_mount_keys_unqualified")
        return [copy.deepcopy(self._specs[key]) for key in keys]

    def verify_container_mounts(self, actual_mounts, keys):
        """Pass ALL volume-type mounts: anonymous or ordinary extras reject."""
        expected = self.expected_mounts(keys)
        require(type(actual_mounts) is list and len(actual_mounts) == len(expected), "owned_volume_mount_count_unqualified")
        for spec in expected:
            matches = [row for row in actual_mounts if type(row) is dict and row.get("Destination") == spec["destination"]]
            require(len(matches) == 1, "owned_volume_destination_unqualified")
            verify_inspected_mount(spec, matches[0])
        return True

    def verify(self):
        for spec in self._specs.values():
            require(spec["phase"] == "created", "owned_volume_creation_unconfirmed"); self._inspect(spec)
        return True

    def cleanup(self):
        """Prove exact owned Docker refs/metadata gone; no host-erasure claim."""
        for spec in reversed(list(self._specs.values())):
            require(spec["create_pending"] is False, "owned_volume_creation_outcome_unknown")
            require(not spec["activated"] or bool(spec["runtime"]), "owned_volume_activated_runtime_unconfirmed")
            present = spec["name"] in self._census()
            if present: self._inspect(spec)
            references = self._run(["docker", "ps", "--all", "--filter", "volume=" + spec["name"], "--format", "{{json .}}"])
            require(not references.strip(), "owned_volume_container_references_present")
            if not present: continue
            self._run(["docker", "volume", "rm", spec["name"]])  # NEVER force.
            require(spec["name"] not in self._census(), "owned_volume_removal_unconfirmed")
        return True


def restore_from_state(env, *, context_validator, command):
    """Validate current-attempt backstop records only; no Docker action occurs."""
    context_validator(env)
    source, run_id, attempt = (env.get(k, "") for k in ["GITHUB_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"])
    identity(source, "0" * 10, run_id, attempt)
    location = env.get("RUNNER_TEMP", "")
    require(type(location) is str and bool(location) and Path(location).is_absolute(), "owned_volume_context_unqualified")
    root = Path(location).resolve()
    require(root.is_dir() and root != Path("/"), "owned_volume_context_unqualified")
    managers = []
    prefix = "kova-ram-volumes-" + run_id + "-" + attempt + "-"
    for path in sorted(root.glob(prefix + "*.json")):
        owner = path.name[len(prefix):-5]; identity(source, owner, run_id, attempt)
        value = private_state(path)
        expected = {"format": 1, "source": source, "owner": owner, "runId": run_id, "attempt": attempt, "uid": os.getuid()}
        require(type(value) is dict and type(value.get("format")) is int and set(value) == set(expected) | {"specs"}
                and all(value.get(k) == v for k, v in expected.items())
                and type(value["specs"]) is dict and 0 < len(value["specs"]) <= 64,
                "owned_volume_cleanup_state_unqualified")
        manager = object.__new__(OwnedVolumes)
        manager.source, manager.owner, manager.run_id, manager.attempt = source, owner, run_id, attempt
        manager.runner_temp, manager.state_path, manager.command, manager._specs = root, path, command, {}
        for key, spec in value["specs"].items():
            require(type(spec) is dict, "owned_volume_cleanup_recipe_unqualified")
            derived = manager._spec(key, *(spec.get(k) for k in ["destination", "size_mib", "uid", "gid", "mode"]))
            require(set(spec) == set(derived) and all(spec[k] == derived[k] for k in derived if k not in {"phase", "mountpoint", "create_pending", "activated", "runtime"})
                    and spec.get("phase") in {"planned", "created"}
                    and type(spec.get("create_pending")) is bool and type(spec.get("activated")) is bool
                    and type(spec.get("runtime")) is list and len(spec["runtime"]) <= 1
                    and (spec["phase"] != "created" or spec["create_pending"] is False)
                    and (spec["mountpoint"] is None and spec["phase"] == "planned"
                         or mountpoint(spec["mountpoint"], spec["name"])), "owned_volume_cleanup_recipe_unqualified")
            manager._specs[key] = copy.deepcopy(spec)
        for item in manager._specs.values():
            if item["runtime"]:
                row = item["runtime"][0]
                require(type(row) is dict and set(row) == {"name", "device", "root", "hostmountpoint", "destination"}
                        and item["phase"] == "created" and item["activated"] is True
                        and row.get("name") == item["name"] and row.get("destination") == item["destination"]
                        and row.get("hostmountpoint") == item["mountpoint"] and row.get("root") == "/"
                        and type(row.get("device")) is str and re.fullmatch(r"[0-9]{1,10}:[0-9]{1,10}", row["device"]),
                        "owned_volume_runtime_state_unqualified")
        managers.append(manager)
    return managers
