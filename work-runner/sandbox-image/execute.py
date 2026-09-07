"""Fixed entrypoint for the isolated container only; never run on the host.

No network, package installation, host mounts, or credentials are available.
Python's standard library includes csv, json, math, statistics, and sqlite3.
"""
import base64
import errno
import json
import os
import re
import resource
import signal
import stat
import subprocess
import sys
import tempfile

MAX_INPUT = 8 * 1024 * 1024
MAX_OUTPUT = 8 * 1024 * 1024
MAX_LOG = 64 * 1024
MAX_FILES = 16
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
STAGE = "preflight"


def failure_code(stage, error):
    """Finite diagnostics only: never disclose exception text, paths or input."""
    if stage not in ("preflight", "workspace", "child", "outputs", "response"):
        stage = "preflight"
    category = "internal"
    if isinstance(error, ValueError):
        category = "invalid"
    elif isinstance(error, (TimeoutError, subprocess.TimeoutExpired)):
        category = "timeout"
    elif isinstance(error, OSError):
        if error.errno in (errno.EACCES, errno.EPERM):
            category = "permission"
        elif error.errno in (errno.ENOMEM, errno.EMFILE, errno.ENFILE, errno.EAGAIN, errno.EFBIG):
            category = "limit"
        elif error.errno in (errno.ENOENT, errno.ENOTDIR, errno.ENOSPC, errno.EROFS):
            category = "storage"
    return "sandbox_execution_failed_" + stage + "_" + category


def require(ok):
    if not ok:
        raise ValueError("sandbox_request_invalid")


def filename(value):
    require(isinstance(value, str) and NAME.fullmatch(value) and value not in (".", ".."))
    return value


def limits():
    resource.setrlimit(resource.RLIMIT_CPU, (20, 20))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT, MAX_OUTPUT))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def main():
    global STAGE
    STAGE = "preflight"
    # The marker and UID check make accidental invocation visibly fail. Resource
    # isolation comes from required runsc/container flags, never Python checks.
    require(os.getuid() == 65532 and os.path.isdir("/job") and os.path.isfile("/.dockerenv"))
    raw = sys.stdin.buffer.read(12 * 1024 * 1024 + 1)
    require(len(raw) <= 12 * 1024 * 1024)
    job = json.loads(raw)
    require(isinstance(job, dict) and job.get("version") == 1)
    require(isinstance(job.get("jobId"), str) and re.fullmatch(r"[A-Za-z0-9_-]{1,100}", job["jobId"]))
    require(isinstance(job.get("code"), str) and 0 < len(job["code"].encode()) <= 65536)
    require(type(job.get("timeoutMs")) is int and 1000 <= job["timeoutMs"] <= 30000)
    require(type(job.get("maxOutputBytes")) is int and 1 <= job["maxOutputBytes"] <= MAX_OUTPUT)
    require(isinstance(job.get("inputFiles"), list) and len(job["inputFiles"]) <= MAX_FILES)
    STAGE = "workspace"
    root = tempfile.mkdtemp(prefix="run-", dir="/job")
    inputs, outputs = os.path.join(root, "inputs"), os.path.join(root, "outputs")
    os.mkdir(inputs, 0o700)
    os.mkdir(outputs, 0o700)
    names, total = set(), 0
    for item in job["inputFiles"]:
        name = filename(item.get("name"))
        require(name.lower() not in names and isinstance(item.get("base64"), str))
        names.add(name.lower())
        data = base64.b64decode(item["base64"], validate=True)
        total += len(data)
        require(total <= MAX_INPUT)
        path = os.path.join(inputs, name)
        with open(path, "xb") as target:
            target.write(data)
        os.chmod(path, 0o444)
    code_path = os.path.join(root, "main.py")
    with open(code_path, "x", encoding="utf-8") as target:
        target.write(job["code"])
    os.chmod(code_path, 0o444)
    out_path, err_path = os.path.join(root, "stdout"), os.path.join(root, "stderr")
    STAGE = "child"
    with open(out_path, "xb") as stdout, open(err_path, "xb") as stderr:
        child = subprocess.Popen(
            ["/usr/local/bin/python3", "-I", "-B", code_path],
            stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, cwd=root,
            env={"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8",
                 "KOVA_INPUT_DIR": inputs, "KOVA_OUTPUT_DIR": outputs},
            start_new_session=True, preexec_fn=limits,
        )
        try:
            code = child.wait(timeout=max(0.1, job["timeoutMs"] / 1000 - 0.5))
        except subprocess.TimeoutExpired:
            code = -signal.SIGKILL
        finally:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait(timeout=1)
    def read_log(path):
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as stream:
            require(stat.S_ISREG(os.fstat(stream.fileno()).st_mode))
            # Bound bytes after replacement as malformed UTF-8 can expand.
            return stream.read(MAX_LOG).decode("utf-8", errors="replace").encode()[:MAX_LOG].decode("utf-8", errors="ignore")
    STAGE = "outputs"
    files, names, total = [], set(), 0
    with os.scandir(outputs) as entries:
        for entry in entries:
            require(len(files) < MAX_FILES)
            name = filename(entry.name)
            require(name.lower() not in names)
            names.add(name.lower())
            fd = os.open(entry.path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, "rb") as stream:
                info = os.fstat(stream.fileno())
                require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= job["maxOutputBytes"] - total)
                data = stream.read(job["maxOutputBytes"] - total + 1)
                total += len(data)
                require(total <= job["maxOutputBytes"])
            files.append({"name": name, "base64": base64.b64encode(data).decode("ascii")})
    response = {"version": 1, "jobId": job["jobId"], "stdout": read_log(out_path), "stderr": read_log(err_path), "exitCode": code, "outputs": sorted(files, key=lambda file: file["name"])}
    STAGE = "response"
    sys.stdout.write(json.dumps(response, separators=(",", ":"), ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except BaseException as error:
        sys.stderr.write(failure_code(STAGE, error) + "\n")
        sys.exit(1)
