import { SYSTEM_PROMPT, GREETING } from "./prompt";

const SAMPLE_RATE = 24000;
const WS_URL = "wss://agents.assemblyai.com/v1/voice";
const API_BASE = import.meta.env.VITE_BACKEND_URL || "";

type ToolMeta = {
  name: string;
  args: Record<string, unknown>;
  // compact human-readable summary of the result, used when feeding the
  // transcript back into the LinkedIn-post generator
  summary?: string;
};

type TranscriptItem = {
  id: string;
  role: "user" | "agent" | "tool";
  text: string;
  partial?: boolean;
  tool?: ToolMeta;
};

export type GeneratedPost = {
  text: string;
  model?: string;
};

export type VoiceAgentEvents = {
  onStatus: (status: string) => void;
  onTranscript: (items: TranscriptItem[]) => void;
  onError: (message: string) => void;
  onPost: (post: GeneratedPost) => void;
  onDraftStart: () => void;
  onDraftError: (message: string) => void;
};

const TOOLS = [
  {
    type: "function",
    name: "search_web",
    description:
      "Search the web for facts, statistics, sources, or recent news that could back up a claim the user just made. Use sparingly — only when the user names a specific number, study, public figure, company, or event that would benefit from a citation. Do not search for vague topics or general opinions.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Specific search query — include keywords, names, and numbers. Example: 'percentage of remote workers in tech 2025' rather than 'remote work'.",
        },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "generate_linkedin_post",
    description:
      "Draft the LinkedIn post from the conversation so far. ONLY call this once you have a specific story or moment, at least one concrete detail (a number, quote, name, or visible action), and a clear takeaway. Don't call it on a vague answer. Do not announce that you're calling it; do not read the draft out loud. After it returns, simply tell the user a draft is on screen and ask if they want to tweak the angle.",
    parameters: {
      type: "object",
      properties: {
        angle: {
          type: "string",
          description:
            "Optional one-sentence framing for the post — the angle you think makes it land (e.g. 'the surprise was how quickly the on-call rotation broke'). Skip if unsure.",
        },
      },
    },
  },
];

type PendingTool = { call_id: string; result: string };

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
  private pendingTools: Promise<PendingTool>[] = [];

  constructor(private events: VoiceAgentEvents) {}

  async start(tokenUrl: string, voice: string = "ivy") {
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
            output: { voice },
            tools: TOOLS,
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

      case "tool.call":
        this.pendingTools.push(this.runTool(msg));
        break;

      case "reply.done":
        if (msg.status === "interrupted") {
          this.pendingTools = [];
          this.stopPlayback();
        } else if (this.pendingTools.length > 0) {
          this.flushTools();
        }
        break;

      case "session.error":
      case "error":
        this.events.onError(msg.message || "session error");
        break;
    }
  }

  private async runTool(msg: any): Promise<PendingTool> {
    const callId: string = msg.call_id || "";
    const name: string = msg.name || "";
    const args = msg.args || {};

    const initialText =
      name === "search_web"
        ? `🔍 Searching: "${args.query ?? ""}"`
        : name === "generate_linkedin_post"
          ? "📝 Drafting LinkedIn post…"
          : `Calling ${name}…`;

    const item: TranscriptItem = {
      id: `tool-${callId || Date.now()}`,
      role: "tool",
      text: initialText,
      partial: true,
      tool: { name, args },
    };
    this.transcript.push(item);
    this.events.onTranscript([...this.transcript]);

    let resultJson: string;
    try {
      if (name === "search_web") {
        resultJson = await this.runSearchWeb(item, args);
      } else if (name === "generate_linkedin_post") {
        resultJson = await this.runGeneratePost(item, args);
      } else {
        throw new Error(`unknown tool: ${name}`);
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      resultJson = JSON.stringify({ error: String(msg) });
      item.partial = false;
      item.text = `${name} failed: ${msg}`;
      if (item.tool) item.tool.summary = `error: ${msg}`;
      if (name === "generate_linkedin_post") this.events.onDraftError(msg);
    }
    this.events.onTranscript([...this.transcript]);
    return { call_id: callId, result: resultJson };
  }

  private async runSearchWeb(
    item: TranscriptItem,
    args: any,
  ): Promise<string> {
    const resp = await fetch(`${API_BASE}/api/tool/search_web`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: args.query ?? "" }),
    });
    if (!resp.ok) throw new Error(`tool ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();

    const top = (data.results || [])[0];
    item.partial = false;
    item.text = top
      ? `🔍 Searched: "${args.query}" → ${top.title || top.source || "result"}`
      : `🔍 Searched: "${args.query}" → no results`;
    if (item.tool) {
      const summary = (data.results || [])
        .slice(0, 3)
        .map(
          (r: any) =>
            `${r.title || r.source || "result"}${r.snippet ? ` — ${r.snippet}` : ""}`,
        )
        .join(" | ");
      item.tool.summary = `query="${args.query ?? ""}" → ${summary || "no results"}`;
    }
    return JSON.stringify(data);
  }

  private async runGeneratePost(
    item: TranscriptItem,
    args: any,
  ): Promise<string> {
    const post = await this.callGeneratePost({
      angle: args.angle ?? null,
      excludeId: item.id,
    });

    item.partial = false;
    item.text = "📝 Drafted LinkedIn post";
    if (item.tool) {
      item.tool.summary = `generated ${post.text.length}-char post (model=${post.model ?? "?"})`;
    }

    // Hand the agent a short ack instead of the full post — we don't want it
    // reading the draft aloud. The post is shown to the user on screen.
    return JSON.stringify({
      status: "ok",
      message:
        "Draft generated and shown to the user on screen. Tell them it's ready and ask if they want to tweak the angle. Do not read the draft aloud.",
    });
  }

  // Manual draft path — invoked from the UI button, bypassing the agent.
  // Throws on failure; caller is responsible for surfacing errors.
  async generatePost(angle?: string): Promise<GeneratedPost> {
    return this.callGeneratePost({ angle: angle ?? null });
  }

  private async callGeneratePost(opts: {
    angle: string | null;
    excludeId?: string;
  }): Promise<GeneratedPost> {
    const turns = this.transcript
      .filter((t) => !opts.excludeId || t.id !== opts.excludeId)
      .map((t) => ({
        role: t.role,
        text: t.role === "tool" ? t.tool?.summary ?? t.text : t.text,
      }))
      .filter((t) => t.text && t.text.trim());

    if (turns.length === 0) throw new Error("transcript is empty");

    this.events.onDraftStart();
    const resp = await fetch(`${API_BASE}/api/tool/generate_post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turns, angle: opts.angle }),
    });
    if (!resp.ok) throw new Error(`${resp.status}: ${await resp.text()}`);
    const data = await resp.json();

    const post: GeneratedPost = { text: data.post ?? "", model: data.model };
    this.events.onPost(post);
    return post;
  }

  private async flushTools() {
    const pending = this.pendingTools;
    this.pendingTools = [];
    const results = await Promise.all(pending);
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    for (const r of results) {
      this.ws.send(
        JSON.stringify({ type: "tool.result", call_id: r.call_id, result: r.result }),
      );
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
    this.pendingTools = [];
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
