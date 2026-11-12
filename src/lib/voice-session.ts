const SESSION_DURATION_MS = 60 * 60 * 1000;
const localSessions = new Set<string>();

type SessionEnd = "time-limit" | "other-tab";
export type VoiceSessionNotice = "voice_context_full" | "voice_session_limit" | "voice_conflict";
export type VoiceSessionLease = {
  current: () => boolean;
  release: () => void;
};
type LeaseResult =
  { status: "active"; lease: VoiceSessionLease } | { status: "conflict" | "unavailable" };

export function acquireVoiceSession(
  ownerId: string,
  onEnd: (reason: SessionEnd) => void,
): Promise<LeaseResult> {
  const name = `kova-voice-session:${ownerId}`;
  return new Promise((resolve) => {
    const hold = (unlock: () => void) => {
      const expiresAt = Date.now() + SESSION_DURATION_MS;
      let released = false;
      let channel: BroadcastChannel | undefined;
      const finish = (reason?: SessionEnd) => {
        if (released) return;
        released = true;
        clearTimeout(timeout);
        document.removeEventListener("visibilitychange", check);
        channel?.close();
        unlock();
        if (reason) onEnd(reason);
      };
      const check = () => {
        if (Date.now() >= expiresAt) finish("time-limit");
        return !released;
      };
      const timeout = setTimeout(() => finish("time-limit"), SESSION_DURATION_MS);
      document.addEventListener("visibilitychange", check);
      if (navigator.locks && typeof BroadcastChannel === "function") {
        try {
          channel = new BroadcastChannel(name);
          channel.onmessage = (event) => {
            if (event.data === "end-voice-session") finish("other-tab");
          };
        } catch {
          // The exclusive lock still works without cross-tab messaging.
        }
      }
      resolve({ status: "active", lease: { current: check, release: () => finish() } });
    };
    if (!navigator.locks) {
      if (localSessions.has(name)) {
        resolve({ status: "conflict" });
        return;
      }
      localSessions.add(name);
      hold(() => localSessions.delete(name));
      return;
    }
    void navigator.locks
      .request(name, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve({ status: "conflict" });
          return;
        }
        return new Promise<void>(hold);
      })
      .catch(() => resolve({ status: "unavailable" }));
  });
}

export function endOtherVoiceSession(ownerId: string) {
  if (!navigator.locks || typeof BroadcastChannel !== "function") return false;
  try {
    const channel = new BroadcastChannel(`kova-voice-session:${ownerId}`);
    channel.postMessage("end-voice-session");
    channel.close();
    return true;
  } catch {
    return false;
  }
}
