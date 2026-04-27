// Captures mic audio at the AudioContext sample rate (24kHz),
// converts Float32 -> Int16, and posts ~50ms PCM16 chunks to the main thread.

class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // 50ms at 24kHz = 1200 samples
    this.targetSamples = 1200;
    this.buffer = new Int16Array(this.targetSamples);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      // clamp + convert Float32 [-1, 1] to Int16
      const s = Math.max(-1, Math.min(1, channel[i]));
      this.buffer[this.offset++] = s < 0 ? s * 0x8000 : s * 0x7fff;

      if (this.offset >= this.targetSamples) {
        // transfer the underlying buffer to avoid copies
        this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
        this.buffer = new Int16Array(this.targetSamples);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("mic-processor", MicProcessor);
