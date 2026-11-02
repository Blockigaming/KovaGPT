"""Native, credential-free regression for real pg_dump17 archive grammar."""
import importlib.util
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/release/managed-auth-recovery.py"
spec = importlib.util.spec_from_file_location("native_archive_recovery", SCRIPT)
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


@unittest.skipUnless(os.environ.get("KOVA_NATIVE_PG17_BIN"), "native PostgreSQL17 tools required")
class NativeArchiveTests(unittest.TestCase):
    def test_actual_serial_default_archive_is_lossless_and_restorable(self):
        self.assertNotEqual(os.geteuid(), 0, "native cluster must be nonroot")
        self.assertFalse(any(key.startswith("PG") for key in os.environ), "ambient PG targets rejected")
        self.assertNotIn("KOVA_PRODUCTION_DATABASE_URL", os.environ)
        binary = Path(os.environ["KOVA_NATIVE_PG17_BIN"])
        self.assertTrue(binary.is_absolute())
        env = {key: os.environ[key] for key in ["PATH", "HOME", "LANG", "LD_LIBRARY_PATH"] if key in os.environ}
        def command(name, *args, stdin=None):
            result = subprocess.run([str(binary / name), *args], input=stdin, env=env,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60, check=True)
            self.assertLessEqual(len(result.stdout), 1024 * 1024)
            return result.stdout
        self.assertRegex(command("pg_dump", "--version").decode(), r"PostgreSQL\) 17\.")
        with tempfile.TemporaryDirectory(prefix="kova-native-archive-") as directory:
            root = Path(directory)
            root.chmod(0o700)
            data, socket = root / "data", root / "socket"
            socket.mkdir(mode=0o700)
            started = False
            try:
                command("initdb", "-D", str(data), "--no-locale", "--encoding=UTF8", "--auth-local=trust")
                # No TCP listener and no pre-existing database/credential inputs.
                with (data / "postgresql.conf").open("a") as config:
                    config.write("\nlisten_addresses=''\nunix_socket_directories='" + str(socket) + "'\n")
                command("pg_ctl", "-D", str(data), "-l", str(root / "server.log"), "-w", "start")
                started = True
                def sql(text):
                    return command("psql", "-h", str(socket), "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", text)
                sql("create table public.synthetic_archive (id serial primary key, label text default 'literal'); insert into public.synthetic_archive(label) values ('sample');")
                archive = root / "synthetic.dump"
                command("pg_dump", "-h", str(socket), "-d", "postgres", "--format=custom", "--file", str(archive))
                toc = command("pg_restore", "--list", str(archive)).decode()
                entries = recovery.toc_entries(toc)
                defaults = [entry for entry in entries if entry["kind"] == "DEFAULT"]
                self.assertTrue(defaults, "real serial DEFAULT entry must be tested")
                catalog = {"schemas": [{"name": "public"}], "extensions": [], "publications": []}
                for selector in [recovery.schema_restore_list, recovery.empty_schema_restore_list]:
                    selected = selector(entries, catalog, catalog).decode()
                    for entry in defaults:
                        self.assertIn(entry["line"] + "\n", selected)
                schema = command("pg_restore", "--schema-only", "--file=-", str(archive)).decode()
                self.assertRegex(schema, r"ALTER COLUMN id SET DEFAULT nextval")
                # Restore only the synthetic table in a separate disposable DB.
                sql("create database kova_archive_restored")
                command("pg_restore", "-h", str(socket), "-d", "kova_archive_restored", "--exit-on-error", str(archive))
                restored = command("psql", "-h", str(socket), "-d", "kova_archive_restored", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c",
                                   "insert into public.synthetic_archive default values returning id,label")
                self.assertIn(b"2|literal", restored)
            finally:
                if started:
                    command("pg_ctl", "-D", str(data), "-m", "immediate", "-w", "stop")


if __name__ == "__main__":
    unittest.main()
