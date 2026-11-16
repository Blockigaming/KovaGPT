export function spriteVideoFormat() {
  if (
    typeof MediaRecorder === "undefined" ||
    typeof HTMLCanvasElement === "undefined" ||
    typeof HTMLCanvasElement.prototype.captureStream !== "function"
  )
    return undefined;
  return [
    { mime: "video/webm;codecs=vp8", extension: "webm" },
    { mime: "video/mp4", extension: "mp4" },
  ].find(({ mime }) => MediaRecorder.isTypeSupported(mime));
}

export async function recordSpriteVideo(
  canvas: HTMLCanvasElement,
  draw: (frame: number) => void,
  frames: number,
  delay: number,
  mime: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const stream = canvas.captureStream(Math.min(30, Math.ceil(1000 / delay)));
  try {
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_200_000 });
    return await new Promise<Blob>((resolve, reject) => {
      const chunks: Blob[] = [];
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        cleanup();
        if (recorder.state !== "inactive") recorder.stop();
        reject(signal.reason);
      };
      recorder.onerror = () => {
        cleanup();
        reject(new Error("The browser could not encode the video."));
      };
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        cleanup();
        const blob = new Blob(chunks, { type: recorder.mimeType || mime });
        if (blob.size) resolve(blob);
        else reject(new Error("The video encoder returned an empty file."));
      };
      let frame = 0;
      const next = () => {
        try {
          frame += 1;
          if (frame >= frames) recorder.stop();
          else {
            draw(frame);
            timer = setTimeout(next, delay);
          }
        } catch (cause) {
          cleanup();
          reject(cause);
        }
      };
      signal.addEventListener("abort", abort, { once: true });
      try {
        recorder.start();
        draw(0);
        timer = setTimeout(next, delay);
      } catch (cause) {
        cleanup();
        reject(cause);
      }
    });
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}
