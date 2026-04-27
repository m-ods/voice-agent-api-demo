import { useEffect, useRef, useState } from "react";
import { VoiceAgent, type TranscriptItem } from "./voiceAgent";

const TOKEN_URL = import.meta.env.VITE_TOKEN_URL || "/api/voice-token";

export default function App() {
  const [status, setStatus] = useState("idle");
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const agentRef = useRef<VoiceAgent | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

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
      await agent.start(TOKEN_URL);
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
    <div className="app">
      <header>
        <h1>LinkedIn Post Interviewer</h1>
        <p className="subtitle">
          Talk to the agent. It will interview you to extract a post in your own words.
        </p>
      </header>

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
        <span className={`status status-${status.replace(/\s+/g, "-")}`}>{status}</span>
      </div>

      {error && <div className="error">⚠ {error}</div>}

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
    </div>
  );
}
