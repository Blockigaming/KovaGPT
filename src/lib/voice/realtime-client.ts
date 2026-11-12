const REALTIME_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";

export async function listenForVoiceTurn({
  signal,
  getToken,
  onListening,
}: {
  signal: AbortSignal;
  getToken: () => Promise<string>;
  onListening: () => void;
}): Promise<string> {
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined")
    throw new Error("Live Voice needs a browser with microphone and Web Audio support.");

  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let socket: WebSocket | undefined;
  let capture: AudioWorkletNode | undefined;
  const stopTracks = () => stream?.getTracks().forEach((track) => track.stop());
  signal.addEventListener("abort", stopTracks, { once: true });
  try {
    signal.throwIfAborted();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    signal.throwIfAborted();
    context = new AudioContext({ sampleRate: 16000 });
    const audio = context;
    if (audio.sampleRate !== 16000) throw new Error("This browser could not start live audio.");
    await audio.audioWorklet.addModule("/worklets/voice-pcm.js");
    signal.throwIfAborted();
    const token = await getToken();
    signal.throwIfAborted();

    const url = new URL(REALTIME_URL);
    url.search = new URLSearchParams({
      token,
      model_id: "scribe_v2_realtime",
      audio_format: "pcm_16000",
      commit_strategy: "vad",
    }).toString();

    const connection = new WebSocket(url);
    socket = connection;
    const node = new AudioWorkletNode(audio, "kova-voice-pcm");
    capture = node;
    const source = audio.createMediaStreamSource(stream);

    return await new Promise<string>((resolve, reject) => {
      const abort = () => {
        cleanup();
        reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      const cleanup = () => {
        clearTimeout(connectDeadline);
        signal.removeEventListener("abort", abort);
      };
      const fail = (message: string) => {
        cleanup();
        reject(new Error(message));
      };
      const connectDeadline = setTimeout(
        () => fail("Live Voice took too long to connect."),
        15_000,
      );
      if (signal.aborted) abort();
      connection.onerror = () => fail("Live Voice lost its connection. Tap Voice to reconnect.");
      connection.onclose = () => fail("Live Voice disconnected. Tap Voice to reconnect.");
      connection.onmessage = ({ data }) => {
        let event: { message_type?: string; text?: string };
        try {
          event = JSON.parse(data);
        } catch {
          fail("Live Voice returned an unreadable response.");
          return;
        }
        switch (event.message_type) {
          case "session_started":
            void audio
              .resume()
              .then(() => {
                if (signal.aborted || connection.readyState !== WebSocket.OPEN) return;
                clearTimeout(connectDeadline);
                source.connect(node).connect(audio.destination);
                onListening();
              })
              .catch(() => fail("This browser could not start live audio."));
            break;
          case "committed_transcript":
            if (typeof event.text === "string" && event.text.trim()) {
              cleanup();
              resolve(event.text.trim());
            }
            break;
          case "partial_transcript":
          case "warning":
            break;
          default:
            fail("Live Voice paused. Tap Voice to reconnect.");
        }
      };
      node.port.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
        if (connection.readyState !== WebSocket.OPEN || signal.aborted) return;
        if (connection.bufferedAmount > 128 * 1024) {
          fail("Your connection is too slow for Live Voice. Try again.");
          return;
        }
        const bytes = new Uint8Array(data);
        connection.send(
          JSON.stringify({
            message_type: "input_audio_chunk",
            audio_base_64: btoa(String.fromCharCode(...bytes)),
            sample_rate: 16000,
          }),
        );
      };
    });
  } finally {
    signal.removeEventListener("abort", stopTracks);
    stopTracks();
    if (socket) {
      socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
    }
    if (capture) capture.port.close();
    if (context) void context.close().catch(() => undefined);
  }
}
