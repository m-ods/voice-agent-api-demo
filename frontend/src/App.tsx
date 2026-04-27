import { useEffect, useRef, useState } from "react";
import { VoiceAgent, type TranscriptItem } from "./voiceAgent";
import { VOICE_GROUPS, DEFAULT_VOICE } from "./voices";

const TOKEN_URL = import.meta.env.VITE_TOKEN_URL || "/api/voice-token";
const VOICE_STORAGE_KEY = "voice-agent-demo:voice";

export default function App() {
  const [status, setStatus] = useState("idle");
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [voice, setVoice] = useState<string>(
    () => localStorage.getItem(VOICE_STORAGE_KEY) || DEFAULT_VOICE,
  );
  const agentRef = useRef<VoiceAgent | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    localStorage.setItem(VOICE_STORAGE_KEY, voice);
  }, [voice]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  const start = async () => {
    setError(null);
    setTranscript([]);
    const agent = new VoiceAgent({
      onStatus: setStatus,
      onTranscript: setTranscript,
      onError: (m) => setError(m),
    });
    agentRef.current = agent;
    try {
      await agent.start(TOKEN_URL, voice);
      setRunning(true);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setRunning(false);
    }
  };

  const stop = async () => {
    await agentRef.current?.stop();
    agentRef.current = null;
    setRunning(false);
  };

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <span className="logo" aria-hidden>in</span>
          <span className="topbar-title">Post Interviewer</span>
        </div>
      </div>

      <div className="app">
        <section className="card card-header">
          <h1>Find your next post</h1>
          <p className="subtitle">
            Talk to the interviewer. It draws out a story in your own words so the post sounds like you.
          </p>
          <div className="controls">
            {!running ? (
              <button className="primary" onClick={start}>
                Start interview
              </button>
            ) : (
              <button className="secondary" onClick={stop}>
                End interview
              </button>
            )}
            <label className="voice-picker">
              <span className="voice-picker-label">Voice</span>
              <select
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                disabled={running}
                aria-label="Interviewer voice"
              >
                {VOICE_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.voices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <span className={`status status-${status.replace(/\s+/g, "-")}`}>{status}</span>
          </div>
        </section>

        {error && <div className="error">⚠ {error}</div>}

        <section className="card">
          <div className="transcript">
            {transcript.length === 0 && (
              <div className="empty">Transcript will appear here once the conversation starts.</div>
            )}
            {transcript.map((item) => (
              <div key={item.id} className={`turn turn-${item.role}`}>
                <div className="role">{item.role === "user" ? "You" : "Interviewer"}</div>
                <div className={`text ${item.partial ? "partial" : ""}`}>{item.text}</div>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>
        </section>
      </div>
    </>
  );
}
