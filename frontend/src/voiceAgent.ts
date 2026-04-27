import { SYSTEM_PROMPT, GREETING } from "./prompt";

const SAMPLE_RATE = 24000;
const WS_URL = "wss://agents.assemblyai.com/v1/voice";

type TranscriptItem = {
  id: string;
  role: "user" | "agent";
  text: string;
  partial?: boolean;
};

export type VoiceAgentEvents = {
  onStatus: (status: string) => void;
  onTranscript: (items: TranscriptItem[]) => void;
  onError: (message: string) => void;
};

const b64encode = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};

const b64decode = (b64: string) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
};

export class VoiceAgent {
  private ws: WebSocket | null = null;
  private audioCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private playbackTime = 0;
  private scheduledSources: AudioBufferSourceNode[] = [];
  private sessionReady = false;
  private transcript: TranscriptItem[] = [];
  private partialUserId: string | null = null;

  constructor(private events: VoiceAgentEvents) {}

  async start(tokenUrl: string) {
    this.events.onStatus("requesting token...");
    const tokenResp = await fetch(tokenUrl);
    if (!tokenResp.ok) {
      throw new Error(`Token request failed: ${tokenResp.status} ${await tokenResp.text()}`);
    }
    const { token } = await tokenResp.json();

    this.events.onStatus("requesting microphone...");
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    if (this.audioCtx.state === "suspended") await this.audioCtx.resume();
    await this.audioCtx.audioWorklet.addModule("/mic-worklet.js");

    this.sourceNode = this.audioCtx.createMediaStreamSource(this.mediaStream);
    this.workletNode = new AudioWorkletNode(this.audioCtx, "mic-processor");
    this.sourceNode.connect(this.workletNode);
    // Worklet must be connected to the graph to run — route through a muted gain to destination.
    const sink = this.audioCtx.createGain();
    sink.gain.value = 0;
    this.workletNode.connect(sink).connect(this.audioCtx.destination);

    this.workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (!this.sessionReady || this.ws?.readyState !== WebSocket.OPEN) return;
      this.ws.send(
        JSON.stringify({ type: "input.audio", audio: b64encode(e.data) }),
      );
    };

    this.events.onStatus("connecting...");
    const wsUrl = new URL(WS_URL);
    wsUrl.searchParams.set("token", token);
    this.ws = new WebSocket(wsUrl);

    this.ws.addEventListener("open", () => {
      this.ws!.send(
        JSON.stringify({
          type: "session.update",
          session: {
            system_prompt: SYSTEM_PROMPT,
            greeting: GREETING,
            output: { voice: "dawn" },
          },
        }),
      );
    });

    this.ws.addEventListener("message", (event) => this.handleMessage(event));
    this.ws.addEventListener("error", () => this.events.onError("websocket error"));
    this.ws.addEventListener("close", () => {
      this.sessionReady = false;
      this.events.onStatus("disconnected");
    });
  }

  private handleMessage(event: MessageEvent) {
    let msg: any;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    switch (msg.type) {
      case "session.ready":
        this.sessionReady = true;
        this.events.onStatus("listening");
        break;

      case "input.speech.started":
        // user is barging in — flush any pending agent audio
        this.stopPlayback();
        break;

      case "transcript.user.delta": {
        if (!this.partialUserId) {
          this.partialUserId = `u-${Date.now()}`;
          this.transcript.push({
            id: this.partialUserId,
            role: "user",
            text: msg.text || "",
            partial: true,
          });
        } else {
          const item = this.transcript.find((t) => t.id === this.partialUserId);
          if (item) item.text = msg.text || "";
        }
        this.events.onTranscript([...this.transcript]);
        break;
      }

      case "transcript.user": {
        if (this.partialUserId) {
          const item = this.transcript.find((t) => t.id === this.partialUserId);
          if (item) {
            item.text = msg.text;
            item.partial = false;
          }
          this.partialUserId = null;
        } else {
          this.transcript.push({
            id: msg.item_id || `u-${Date.now()}`,
            role: "user",
            text: msg.text,
          });
        }
        this.events.onTranscript([...this.transcript]);
        break;
      }

      case "reply.audio":
        this.playPcmChunk(b64decode(msg.data));
        break;

      case "transcript.agent":
        this.transcript.push({
          id: msg.item_id || `a-${Date.now()}`,
          role: "agent",
          text: msg.text,
        });
        this.events.onTranscript([...this.transcript]);
        break;

      case "reply.done":
        if (msg.status === "interrupted") this.stopPlayback();
        break;

      case "session.error":
      case "error":
        this.events.onError(msg.message || "session error");
        break;
    }
  }

  private playPcmChunk(buf: ArrayBuffer) {
    if (!this.audioCtx) return;
    const pcm16 = new Int16Array(buf);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 0x8000;

    const audioBuffer = this.audioCtx.createBuffer(1, float32.length, SAMPLE_RATE);
    audioBuffer.copyToChannel(float32, 0);

    const src = this.audioCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(this.audioCtx.destination);

    const now = this.audioCtx.currentTime;
    const startAt = Math.max(now, this.playbackTime);
    src.start(startAt);
    this.playbackTime = startAt + audioBuffer.duration;

    this.scheduledSources.push(src);
    src.onended = () => {
      this.scheduledSources = this.scheduledSources.filter((s) => s !== src);
    };
  }

  private stopPlayback() {
    for (const src of this.scheduledSources) {
      try {
        src.stop();
      } catch {
        // already stopped
      }
    }
    this.scheduledSources = [];
    this.playbackTime = this.audioCtx?.currentTime ?? 0;
  }

  async stop() {
    this.sessionReady = false;
    this.stopPlayback();
    this.ws?.close();
    this.ws = null;
    this.workletNode?.disconnect();
    this.sourceNode?.disconnect();
    this.mediaStream?.getTracks().forEach((t) => t.stop());
    await this.audioCtx?.close();
    this.audioCtx = null;
    this.mediaStream = null;
    this.workletNode = null;
    this.sourceNode = null;
    this.events.onStatus("idle");
  }
}

export type { TranscriptItem };
