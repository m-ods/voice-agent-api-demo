# Voice Agent API Demo — LinkedIn Post Interviewer

A simple voice agent that interviews you about your week and helps you find a LinkedIn post in your own words and tone. Built with [AssemblyAI's Voice Agent API](https://www.assemblyai.com/docs/voice-agents/voice-agent-api).

- **Backend** — Python (FastAPI). Mints short-lived browser tokens so your AssemblyAI API key never leaves the server.
- **Frontend** — React + Vite + TypeScript. Captures mic audio at 24 kHz PCM16 via an `AudioWorklet`, streams it over a WebSocket to AssemblyAI, plays back the agent's voice, and displays a live transcript.

## Run locally

You will need an AssemblyAI API key from [your dashboard](https://www.assemblyai.com/app).

### 1. Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # then put your key in .env
ASSEMBLYAI_API_KEY=... uvicorn main:app --reload --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Click "Start interview" and grant mic access. The Vite dev server proxies `/api/*` to the backend on port 8000.

## How it works

```
browser  ──GET /api/voice-token──►  backend  ──GET /v1/token (Bearer key)──►  AssemblyAI
browser  ◄──{ token }────────────  backend  ◄──{ token }─────────────────  AssemblyAI

browser  ◄══════ WebSocket: wss://agents.assemblyai.com/v1/voice?token=… ════►  AssemblyAI
         (mic PCM16 in, agent voice PCM16 out, transcripts both ways)
```

The system prompt (`frontend/src/prompt.ts`) keeps the agent in interview mode — one question at a time, dig for stories, mirror the user's phrasing — instead of drafting the post itself. That's deliberate: the goal of this demo is to capture the user's voice, not to overwrite it.

## Deploy on Railway

Each folder has its own `railway.json`. Create two services in Railway from the same repo:

| Service  | Root directory | Environment variables                                           |
| -------- | -------------- | --------------------------------------------------------------- |
| backend  | `backend`      | `ASSEMBLYAI_API_KEY`, `ALLOWED_ORIGINS=https://<frontend-url>`  |
| frontend | `frontend`     | `VITE_TOKEN_URL=https://<backend-url>/api/voice-token`          |

Generate a public domain for each. `VITE_*` variables must be set at build time, so trigger a rebuild after setting them.

## Project layout

```
backend/
  main.py            FastAPI app, GET /api/voice-token
  requirements.txt
  railway.json
frontend/
  src/
    App.tsx          UI + transcript
    voiceAgent.ts    WebSocket + audio capture/playback
    prompt.ts        system prompt + greeting
  public/
    mic-worklet.js   Float32 → PCM16 in the audio thread
  vite.config.ts     dev proxy /api → backend
  railway.json
```
