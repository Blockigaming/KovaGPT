#!/usr/bin/env python3
"""Genuine credential-free PR rehearsal of the final generic OCI producer.

The locally produced archive is deleted, never uploaded. This workflow cannot
supply a production operator artifact: that origin remains the separate
manual-main prepare workflow, checked again by the reviewed restore loader.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("archive_native_pr_context",HERE/"smoke-synthetic-recovery-native.py")
synthetic=importlib.util.module_from_spec(spec);spec.loader.exec_module(synthetic)
builder=synthetic.builder
require=builder.require
PUBLIC_CODES=frozenset({"native_archive_output_unqualified","native_archive_attempt_reserved",
    "native_archive_intent_unqualified","native_archive_cleanup_unconfirmed",
    "native_archive_rehearsal_unqualified","native_archive_interrupted"})


def paths(env):
    source,run,attempt,temp=synthetic.identities(env)
    root=temp/("kova-native-oci-archive-"+run+"-"+attempt)
    return source,run,attempt,temp,root


def save_intent(file,value):
    temporary=file.with_suffix(".new")
    with temporary.open("xb") as stream:
        os.chmod(temporary,0o600);stream.write(builder.canonical(value))
    os.replace(temporary,file)


class NativeArchiveBuilder(builder.Builder):
    """PR identity is validated independently; production Builder.__init__ stays main-only."""
    def __init__(self,env,output):
        source,run,attempt,temp,root=paths(env)
        self.stage="setup";self.source=source
        self.env={k:v for k,v in env.items() if k in builder.SAFE_HOST_ENV}
        self.temp=temp;self.output=Path(output)
        require(self.output==root/"operator-client-image" and not self.output.exists()
                and not self.output.is_symlink(),"native_archive_output_unqualified")
        self.owner=secrets.token_hex(12);self.tag="kova-recovery-operator:"+self.owner
        self.roundtrip_tag="localhost/kova-recovery-operator-oci:"+self.owner;self.image_id=None;self.build_image_id=None
        self.run_id=run;self.attempt=attempt
        self.ram_volumes=None;self.ram_index=0;self.last_ram_keys=[]
        self.intent_file=root/"owned.json"
        self.intent={"format":1,"source":source,"run":run,"attempt":attempt,"uid":os.getuid(),
            "owner":self.owner,"buildInvoked":False,"buildReturned":False}

    def command(self,argv,**kwargs):
        building=argv[:2]==["docker","build"]
        if building:
            self.intent["buildInvoked"]=True;save_intent(self.intent_file,self.intent)
        try:result=super().command(argv,**kwargs)
        except Exception as error:
            details=getattr(error,"command_details",{})
            if building and type(details) is dict and details.get("status") in {"exit","signal","output-bound"}:
                self.intent["buildReturned"]=True;save_intent(self.intent_file,self.intent)
            raise
        if building:
            self.intent["buildReturned"]=True;save_intent(self.intent_file,self.intent)
        return result


def cleanup(env):
    source,run,attempt,temp,root=paths(env)
    if not root.exists():return True
    st=root.lstat()
    require(root.is_dir() and not root.is_symlink() and st.st_uid==os.getuid()
            and not st.st_mode & 0o077,"native_archive_intent_unqualified")
    file=root/"owned.json"
    require(file.is_file() and not file.is_symlink(),"native_archive_intent_unqualified")
    value=builder.ram.private_state(file)
    expected={"format":1,"source":source,"run":run,"attempt":attempt,"uid":os.getuid()}
    require(type(value) is dict and set(value)==set(expected)|{"owner","buildInvoked","buildReturned"}
            and all(value.get(k)==v for k,v in expected.items())
            and type(value["owner"]) is str and re.fullmatch(r"[a-f0-9]{24}",value["owner"])
            and type(value["buildInvoked"]) is bool and type(value["buildReturned"]) is bool,
            "native_archive_intent_unqualified")
    instance=object.__new__(NativeArchiveBuilder)
    instance.source=source;instance.env={k:v for k,v in env.items() if k in builder.SAFE_HOST_ENV}
    instance.temp=temp;instance.owner=value["owner"];instance.tag="kova-recovery-operator:"+instance.owner
    instance.roundtrip_tag="localhost/kova-recovery-operator-oci:"+instance.owner;instance.stage="setup"
    instance.intent_file=file;instance.intent=value
    managers=builder.ram.restore_from_state(env,context_validator=synthetic.synthetic_context,command=instance.command)
    require(all(manager.owner==instance.owner for manager in managers),"native_archive_intent_unqualified")
    for manager in managers:require(manager.cleanup(),"native_archive_cleanup_unconfirmed")
    require(instance.cleanup_image(),"native_archive_cleanup_unconfirmed")
    # A timed-out build with an unknown outcome can finish after a tag query.
    require(not value["buildInvoked"] or value["buildReturned"],"native_archive_cleanup_unconfirmed")
    output=root/"operator-client-image"
    if output.exists():
        require(output.is_dir() and not output.is_symlink(),"native_archive_output_unqualified")
        shutil.rmtree(output)
    return True


def rehearse(env,output):
    source,run,attempt,temp,root=paths(env)
    receipt_path=Path(output)
    require(receipt_path==root/"receipt.json" and receipt_path.is_absolute(),"native_archive_output_unqualified")
    require(not root.exists() and not root.is_symlink(),"native_archive_attempt_reserved")
    image=NativeArchiveBuilder(env,root/"operator-client-image")
    root.mkdir(mode=0o700)
    save_intent(image.intent_file,image.intent)
    receipt=image.execute()
    require(receipt.get("format")==2 and receipt.get("nativeOciArchiveRoundtripSmokePassed") is True
            and receipt.get("nativeToolSmokePassed") is True and receipt.get("localTagRemoved") is True
            and all(receipt.get(k) is False for k in ["customerDataReceived","sourceDatabaseConnected",
                "targetConnected","restorePerformed","futureRestoreApproved"]),"native_archive_rehearsal_unqualified")
    # The final producer has already confirmed native image/RAM cleanup.
    # Remove its three generic output files before retaining this receipt.
    require({p.name for p in image.output.iterdir()}=={"operator-client.oci.tar",
        "client-image-inventory.json","image-preparation-receipt.json"},"native_archive_rehearsal_unqualified")
    shutil.rmtree(image.output)
    require(not image.output.exists(),"native_archive_cleanup_unconfirmed")
    result={"operation":"credential-free-native-generic-oci-roundtrip","sourceSha":source,
        "runId":run,"attempt":attempt,"nativeOciArchiveRoundtripSmokePassed":True,
        "nativeToolSmokePassed":True,"archiveBytes":receipt["ociArchiveBytes"],
        "archiveSha256":receipt["ociArchiveSha256"],"ociManifestDigest":receipt["ociManifestDigest"],
        "clientImageId":receipt["clientImageId"],"buildClientImageId":receipt["buildClientImageId"],
        "ociRuntimeBindingSha256":receipt["ociRuntimeBindingSha256"],
        "cleanupConfirmed":True,"genericArchiveRemoved":True,"ociArchiveUploaded":False,
        "productionArtifactPrepared":False,"productionMutated":False,"sourceConnected":False,
        "customerRowsUsed":False,"protectedPhraseUsed":False,"restorePerformed":False,
        "futureRestoreApproved":False}
    with receipt_path.open("xb") as stream:
        os.chmod(receipt_path,0o600);stream.write(builder.canonical(result))
    return result


def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    mode=parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--execute",action="store_true");mode.add_argument("--cleanup-only",action="store_true")
    parser.add_argument("--output")
    args=parser.parse_args()
    if args.cleanup_only:
        require(args.output is None,"native_archive_output_unqualified")
        print(json.dumps({"cleanupConfirmed":cleanup(os.environ)},separators=(",",":")))
    else:
        require(args.output is not None,"native_archive_output_unqualified")
        print(json.dumps(rehearse(os.environ,args.output),sort_keys=True,separators=(",",":")))


if __name__=="__main__":
    def interrupted(*_):raise builder.Stopped("native_archive_interrupted")
    signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
    try:main()
    except Exception as error:
        result=builder.public_failure(error)
        code=str(error)
        if code in PUBLIC_CODES|synthetic.SAFE_FAILURE_CODES:result["code"]=code
        result.update(operation="credential-free-native-generic-oci-roundtrip",nativeOciArchiveRoundtripSmokePassed=False,
                      productionArtifactPrepared=False,restorePerformed=False)
        print(json.dumps(result,sort_keys=True,separators=(",",":")))
        raise SystemExit(1)
