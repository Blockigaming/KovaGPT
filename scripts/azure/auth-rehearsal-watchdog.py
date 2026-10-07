#!/usr/bin/env python3
"""Independent, fixed-target ARM stop watchdog. This program cannot start an app.

The Azure CLI is used once, before arming, to obtain a token in memory. The
worker uses bounded HTTPS directly, so shutdown does not depend on a later CLI
refresh or its subprocess lifetime. Tokens never enter argv, files or logs.
"""
import argparse
import datetime as dt
import urllib.error
import urllib.request
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

SUBSCRIPTION = "ab732127-11c3-46a7-a1cb-6ee8d86594f4"
TARGET = ("/subscriptions/" + SUBSCRIPTION + "/resourceGroups/rg-kovagpt-dev/"
          "providers/Microsoft.App/containerApps/ca-kovagpt-auth-rehearsal")
API = "?api-version=2024-03-01"
REQUEST_SECONDS = 8
STOP_BUDGET_SECONDS = 80
STOP_MARGIN_SECONDS = 90

def iso(epoch=None):
    return dt.datetime.fromtimestamp(time.time() if epoch is None else epoch,
                                    dt.timezone.utc).isoformat()

class ArmError(Exception):
    def __init__(self, phase, code):
        self.phase, self.code = phase, code
        super().__init__(phase + ":" + str(code))

class Arm:
    def __init__(self, token):
        self.token = token

    def request(self, method):
        if method not in ("GET", "POST"):
            raise ValueError("Unsupported ARM method")
        path = TARGET + ("/stop" if method == "POST" else "") + API
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                raise ArmError(method, "redirect_refused")
        # Respect Cloud Shell's HTTPS proxy while retaining normal certificate
        # validation. A bare HTTPSConnection can bypass its required egress path.
        opener = urllib.request.build_opener(NoRedirect())
        request = urllib.request.Request("https://management.azure.com" + path,
            method=method, headers={"Authorization": "Bearer " + self.token,
            "Cache-Control": "no-cache", "Content-Length": "0"})
        try:
            with opener.open(request, timeout=REQUEST_SECONDS) as response:
                raw = response.read(2_000_000)
                if response.status not in (200, 202, 204):
                    raise ArmError(method, response.status)
                if method == "POST":
                    return {"accepted": True, "status": response.status}
                result = json.loads(raw)
            if result.get("id", "").lower() != TARGET.lower():
                raise ArmError("target", "mismatch")
            return {"state": result["properties"].get("runningStatus"),
                    "revision": result["properties"].get("latestReadyRevisionName")}
        except urllib.error.HTTPError as error:
            raise ArmError(method, error.code) from None

def save(path, state):
    temporary = Path(str(path) + ".new")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(state, stream)
    os.replace(temporary, path)

def stop_and_verify(arm, record, budget=STOP_BUDGET_SECONDS, clock=time.monotonic, pause=time.sleep, require_acceptance=False):
    end = clock() + budget
    accepted = False
    while clock() < end:
        # Verification still runs after a POST error or timeout: a timeout is an
        # unknown outcome, not proof that Azure did not stop the app.
        if not accepted:
            try:
                record("stop_request", arm.request("POST"))
                accepted = True
            except Exception as error:
                record("stop_error", {"type": type(error).__name__,
                                      "code": getattr(error, "code", None)})
        if clock() >= end:
            return False
        try:
            result = arm.request("GET")
            record("stop_readback", result)
            if result["state"] == "Stopped" and (accepted or not require_acceptance):
                return True
        except Exception as error:
            record("read_error", {"type": type(error).__name__,
                                  "code": getattr(error, "code", None)})
        if clock() < end:
            pause(min(2, end-clock()))
    return False

def worker(args):
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    credential = json.load(sys.stdin)
    sys.stdin.close()
    deadline = float(credential["deadline"])
    stop_at = float(credential["stopAt"])
    expires = float(credential["expires"])
    if deadline <= time.time() or deadline-time.time() > 1200 or expires < deadline+120:
        raise ValueError("Insufficient token or deadline lifetime")
    arm = Arm(credential.pop("token"))
    state = {"target": TARGET, "pid": os.getpid(), "launcherPid": credential["launcherPid"],
             "deadline": iso(deadline), "deadlineEpoch": deadline, "stopAt": iso(stop_at),
             "tokenExpires": iso(expires), "status": "self_test", "events": []}
    def record(kind, details):
        state["events"].append({"at": iso(), "event": kind, **details})
        save(args.state, state)
    try:
        before = arm.request("GET")
        if before["state"] != "Stopped":
            raise ArmError("prestart", "not_stopped")
        if not stop_and_verify(arm, record, budget=24, require_acceptance=True):
            raise ArmError("self_test", "not_verified")
        state.update(status="armed", selfTest=True, armedAt=iso())
        while time.time() < stop_at:
            state.update(heartbeatAt=iso(), parentPid=os.getppid())
            save(args.state, state)
            time.sleep(min(2, max(0, stop_at-time.time())))
        state.update(status="stopping")
        save(args.state, state)
        ok = stop_and_verify(arm, record, budget=min(STOP_BUDGET_SECONDS, max(0,deadline-time.time()-1)))
        state.update(status="stopped" if ok else "stop_failed", finishedAt=iso(),
                     independentlyVerified=ok, finishedBeforeDeadline=time.time()<deadline)
        save(args.state, state)
        return 0 if ok else 2
    except Exception as error:
        state.update(status="failed", failure={"type":type(error).__name__,
                     "phase":getattr(error,"phase",None),"code":getattr(error,"code",None)})
        save(args.state,state)
        return 2

def launch(args):
    if not 120 <= args.seconds <= 1200:
        raise ValueError("Live envelope must be 120–1200 seconds")
    path = Path(args.state).resolve()
    if path.exists():
        raise ValueError("Refusing to overwrite an existing watchdog receipt")
    result = subprocess.run(["az","account","get-access-token","--subscription",SUBSCRIPTION,
                             "--resource","https://management.azure.com/","-o","json"],
                            capture_output=True,text=True,timeout=30,check=True)
    data = json.loads(result.stdout)
    now = time.time()
    deadline = now + (120 if args.self_test else args.seconds)
    stop_at = now + 10 if args.self_test else deadline-STOP_MARGIN_SECONDS
    expires = float(data["expires_on"])
    if expires < deadline+120:
        raise ValueError("Token expires before the bounded stop envelope")
    credential = {"token":data["accessToken"],"expires":expires,"deadline":deadline,
                  "stopAt":stop_at,"launcherPid":os.getpid()}
    log = open(str(path)+".log","x",encoding="utf-8")
    os.chmod(log.name,0o600)
    child = subprocess.Popen([sys.executable,str(Path(__file__).resolve()),"worker","--state",str(path)],
             stdin=subprocess.PIPE,stdout=log,stderr=log,text=True,start_new_session=True,close_fds=True)
    child.stdin.write(json.dumps(credential));child.stdin.close();log.close()
    end = time.monotonic()+30
    while time.monotonic()<end:
        if path.exists():
            state=json.loads(path.read_text())
            if state["status"] in ("armed","stopping","stopped"):
                print(json.dumps({"pid":child.pid,"stateFile":str(path),"target":TARGET,
                                  "deadline":state["deadline"],"selfTest":state.get("selfTest"),
                                  "appStartRequested":False}))
                return 0
            if state["status"] in ("failed","stop_failed"):
                raise ValueError("Actual stop self-test failed; inspect sanitized receipt")
        if child.poll() is not None:
            raise ValueError("Watchdog exited before arming")
        time.sleep(.25)
    raise TimeoutError("Watchdog was not armed in time; startup forbidden")

if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command",choices=("launch","worker"))
    parser.add_argument("--state",required=True)
    parser.add_argument("--seconds",type=int,default=1200)
    parser.add_argument("--self-test",action="store_true")
    arguments=parser.parse_args()
    try:
        sys.exit(worker(arguments) if arguments.command=="worker" else launch(arguments))
    except Exception as error:
        # Never emit subprocess stderr, HTTP bodies, credential JSON or traceback.
        print(json.dumps({"status":"failed","type":type(error).__name__,"appStartRequested":False}),file=sys.stderr)
        sys.exit(2)

