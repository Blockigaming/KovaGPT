export const KOVA_NATIVE_AUDIO_INTERRUPTION = "kova-native-audio-interruption";
export const KOVA_NATIVE_OPEN_VOICE = "kova-native-open-voice";
export const KOVA_NATIVE_BACK = "kova-native-back";

type NativeMessage =
  | { action: "device-lock" | "notifications" | "haptic" }
  | { action: "watch-back"; active: boolean }
  | { action: "share"; text: string }
  | { action: "carplay-voice-state"; state: "listening" | "working" | "speaking" | "ended" }
  | {
      action:
        "voice-reply-begin" | "voice-reply-end" | "android-voice-start" | "android-voice-stop";
      id: string;
    };

type NativeWindow = Window & {
  webkit?: { messageHandlers?: { kovaNative?: { postMessage: (message: NativeMessage) => void } } };
  kovaNative?: { postMessage: (message: string) => void };
};

export function nativeKovaPlatform(): "ios" | "android" | null {
  if (typeof window === "undefined") return null;
  const native = window as NativeWindow;
  if (native.webkit?.messageHandlers?.kovaNative) return "ios";
  return native.kovaNative ? "android" : null;
}

export function sendNativeKovaMessage(message: NativeMessage) {
  const platform = nativeKovaPlatform();
  if (!platform) return false;
  const native = window as NativeWindow;
  try {
    if (platform === "ios") native.webkit!.messageHandlers!.kovaNative!.postMessage(message);
    else native.kovaNative!.postMessage(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

type NativeDictationHandler = {
  postMessage: (message: {
    action: "start" | "start-voice" | "finish" | "cancel" | "mute" | "unmute";
    id: string;
  }) => Promise<boolean>;
};

export function nativeDictationHandler(): NativeDictationHandler | undefined {
  const native = window as Window & {
    webkit?: { messageHandlers?: { kovaDictation?: NativeDictationHandler } };
  };
  return native.webkit?.messageHandlers?.kovaDictation;
}
