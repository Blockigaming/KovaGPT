"""Synthetic kernel metadata only; no Docker, mount or production operation."""
import importlib.util
import os
from pathlib import Path
import subprocess
import unittest


SCRIPT=Path(__file__).resolve().parents[2]/"scripts/release/noswap-volume-proof.py"
spec=importlib.util.spec_from_file_location("noswap_proof_tests",SCRIPT)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def volume(destination="/work",name="kova-ram-synthetic",device="0:123"):
    return {"key":"work","name":name,"destination":destination,
            "mountpoint":"/synthetic/docker/volumes/"+name+"/_data","size_mib":128,
            "uid":1001,"gid":1001,"mode":"1777" if destination=="/tmp" else "0700",
            "nr_inodes":131072,"driver":"local","scope":"local","device":"tmpfs"}


ROOT="1 0 0:9 / / ro,relatime - overlay overlay rw,lowerdir=synthetic\n"
RAM="2 1 0:123 / /work rw,nosuid,nodev,noexec,relatime - tmpfs tmpfs rw,noswap,size=131072k,nr_inodes=131072\n"


def runtime(mounts=ROOT+RAM):
    return ("C\t1001\t0000000000000000\t1\t0\n"+
            "".join("M\t"+line+"\n" for line in mounts.splitlines())+
            f"S\t/work\t1001 1001 700 {os.makedev(0,123)} 1\n"+
            "F\t/work\t32768 4096 131072\n").encode()


class RuntimeProofTests(unittest.TestCase):
    def test_exact_live_metadata_produces_private_kernel_records_and_safe_receipt(self):
        result=m.validate_runtime_proof(runtime(),{"work":volume()})
        self.assertEqual(result["records"],[{"name":"kova-ram-synthetic","device":"0:123","root":"/",
            "hostmountpoint":"/synthetic/docker/volumes/kova-ram-synthetic/_data","destination":"/work"}])
        receipt=result["receipt"]
        self.assertTrue(receipt["tmpfsNoSwapObserved"])
        self.assertTrue(receipt["privateMountPropagationObserved"])
        self.assertTrue(receipt["memorySwapDisabledObserved"])
        self.assertFalse(receipt["customerFileContentsRead"])
        self.assertNotIn("/synthetic",m.canonical(receipt).decode())
        self.assertNotIn("/work",m.canonical(receipt).decode())

    def test_every_security_property_is_required_from_actual_mount_metadata(self):
        for before,after in [("noswap,",""),("nosuid,",""),("nodev,",""),("noexec,",""),
                (" - tmpfs tmpfs "," - ext4 /dev/synthetic "),("0:123 / /work","0:123 /subdir /work"),
                ("relatime - tmpfs","relatime shared:99 - tmpfs"),
                ("relatime - tmpfs","relatime master:99 - tmpfs"),
                ("relatime - tmpfs","relatime unbindable - tmpfs"),
                ("/ / ro,relatime","/ / rw,relatime")]:
            with self.subTest(before=before),self.assertRaises(m.Stopped):
                m.validate_runtime_proof(runtime((ROOT+RAM).replace(before,after)),[volume()])

    def test_capabilities_privileges_swap_uid_owner_mode_device_and_capacity_cannot_be_asserted(self):
        good=runtime()
        for before,after in [(b"C\t1001",b"C\t0"),(b"0000000000000000",b"0000000000200000"),
                (b"\t1\t0\n",b"\t0\t0\n"),(b"\t1\t0\n",b"\t1\tmax\n"),
                (b"1001 1001 700",b"1002 1001 700"),(b"1001 1001 700",b"1001 1002 700"),
                (b"1001 1001 700",b"1001 1001 777"),(b" 123 1\n",b" 124 1\n"),
                (b"32768 4096",b"32767 4096"),(b"4096 131072",b"4096 131073")]:
            bad=good.replace(before,after)
            self.assertNotEqual(bad,good)
            with self.subTest(before=before),self.assertRaises(m.Stopped):
                m.validate_runtime_proof(bad,[volume()])

    def test_shadowed_descendant_missing_duplicate_and_unexpected_stats_are_rejected(self):
        for mounts in [ROOT,ROOT+RAM+RAM.replace("2 1 ","3 1 "),
                ROOT+RAM+"3 2 8:1 / /work/customer rw - ext4 /dev/synthetic rw\n"]:
            with self.subTest(mounts=mounts),self.assertRaises(m.Stopped):
                m.validate_runtime_proof(runtime(mounts),[volume()])
        for extra in [b"S\t/work\t1001 1001 700 123 1\n",b"F\t/unknown\t1 4096 1\n",
                      b"C\t1001\t0000000000000000\t1\t0\n",b"PRIVATE_UNREGISTERED_LINE\n"]:
            with self.subTest(extra=extra),self.assertRaises(m.Stopped):
                m.validate_runtime_proof(runtime()+extra,[volume()])

    def test_mountinfo_parser_preserves_escaped_paths_and_rejects_ambiguous_fields(self):
        value=m.parse_mountinfo("2 1 0:123 / /synthetic\\040space rw - tmpfs tmpfs rw,noswap\n")
        self.assertEqual(value[0]["target"],"/synthetic space")
        for text in [RAM.replace("/work","/work\\999"),RAM.replace(" - "," - - "),RAM+RAM,
                     RAM.replace("0:123","not-device"),"2 1 0:123 / /work rw tmpfs tmpfs rw"]:
            with self.subTest(text=text),self.assertRaises(m.Stopped):m.parse_mountinfo(text)

    def test_fixed_runtime_shell_is_syntax_valid_reads_only_metadata_and_uses_exact_args(self):
        script=m.runtime_proof_script()
        result=subprocess.run(["bash","-n","-c",script],capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr.decode())
        for required in ["/proc/self/mountinfo","/proc/self/status","memory.swap.max",'for destination in "$@"',
                         "stat --file-system",'! -L "$destination"']:
            self.assertIn(required,script)
        for forbidden in ["mount -", "umount", "sudo", "curl", "cat \"$destination\"", "eval "]:
            self.assertNotIn(forbidden,script)



if __name__=="__main__":unittest.main()
