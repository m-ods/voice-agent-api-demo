import { useEffect, useRef, useState } from "react";
import {
  VoiceAgent,
  type GeneratedPost,
  type TranscriptItem,
} from "./voiceAgent";
import { VOICE_GROUPS, DEFAULT_VOICE } from "./voices";

const TOKEN_URL = import.meta.env.VITE_TOKEN_URL || "/api/voice-token";
const VOICE_STORAGE_KEY = "voice-agent-demo:voice";

export default function App() {
  const [status, setStatus] = useState("idle");
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [post, setPost] = useState<GeneratedPost | null>(null);
  const [copied, setCopied] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const userTurnCount = transcript.filter((t) => t.role === "user").length;
  const [voice, setVoice] = useState<string>(
    () => localStorage.getItem(VOICE_STORAGE_KEY) || DEFAULT_VOICE,
  );
  const agentRef = useRef<VoiceAgent | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const postRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    localStorage.setItem(VOICE_STORAGE_KEY, voice);
  }, [voice]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  useEffect(() => {
    if (post) postRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [post]);

  const copyPost = async () => {
    if (!post) return;
    try {
      await navigator.clipboard.writeText(post.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — ignore
    }
  };

  const start = async () => {
    setError(null);
    setTranscript([]);
    setPost(null);
    const agent = new VoiceAgent({
      onStatus: setStatus,
      onTranscript: setTranscript,
      onError: (m) => setError(m),
      onPost: setPost,
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

  const draftNow = async () => {
    if (!agentRef.current || drafting) return;
    setError(null);
    setDrafting(true);
    try {
      await agentRef.current.generatePost();
    } catch (e: any) {
      setError(`Couldn't draft post — ${e?.message ?? String(e)}`);
    } finally {
      setDrafting(false);
    }
  };

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <span className="logo" aria-hidden>in</span>
          <span className="topbar-title">LinkedIn Post Brainstormer</span>
        </div>
      </div>

      <div className="app">
        <section className="card card-header">
          <h1>Brainstorm your next LinkedIn post</h1>
          <p className="subtitle">
            Hit start, then talk for a couple of minutes about something from your week — a project, a meeting, a moment that surprised you. The voice agent asks questions to dig out the story, then drafts a post in your voice. Hit <em>Draft post</em> any time you're ready.
          </p>
          <div className="controls">
            {!running ? (
              <button className="primary" onClick={start}>
                Start
              </button>
            ) : (
              <button className="secondary" onClick={stop}>
                End conversation
              </button>
            )}
            {running && (
              <button
                className="primary"
                onClick={draftNow}
                disabled={drafting || userTurnCount === 0}
                title={
                  userTurnCount === 0
                    ? "Talk a bit first, then draft"
                    : "Draft a post from the conversation so far"
                }
              >
                {drafting ? "Drafting…" : post ? "Redraft post" : "Draft post"}
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

        {post && (
          <section className="card post-card" ref={postRef}>
            <div className="post-header">
              <h2>Draft post</h2>
              <button
                type="button"
                className="post-copy"
                onClick={copyPost}
                aria-label="Copy draft to clipboard"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="post-body">{post.text}</pre>
          </section>
        )}

        <section className="card">
          <div className="transcript">
            {transcript.length === 0 && (
              <div className="empty">
                {running
                  ? "Listening — say what's been on your mind."
                  : "Transcript will appear here once the conversation starts."}
              </div>
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
