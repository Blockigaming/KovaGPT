/* global AudioWorkletProcessor, registerProcessor */
class VoicePcmProcessor extends AudioWorkletProcessor {
  buffer = new Int16Array(1600);
  offset = 0;

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const sample of channel) {
      const clamped = Math.max(-1, Math.min(1, sample));
      this.buffer[this.offset++] = clamped < 0 ? clamped * 32768 : clamped * 32767;
      if (this.offset === this.buffer.length) {
        this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
        this.buffer = new Int16Array(1600);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("kova-voice-pcm", VoicePcmProcessor);
