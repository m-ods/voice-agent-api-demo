import os
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

ASSEMBLYAI_TOKEN_URL = "https://agents.assemblyai.com/v1/token"
LLM_GATEWAY_URL = "https://llm-gateway.assemblyai.com/v1/chat/completions"
LLM_GATEWAY_MODEL = "claude-sonnet-4-6"
EXA_SEARCH_URL = "https://api.exa.ai/search"

app = FastAPI(title="Voice Agent API Demo")

allowed_origins = os.environ.get(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in allowed_origins if o.strip()],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/api/voice-token")
async def voice_token():
    api_key = os.environ.get("ASSEMBLYAI_API_KEY")
    if not api_key:
        raise HTTPException(500, "ASSEMBLYAI_API_KEY is not set on the server")

    params = {
        "expires_in_seconds": "300",
        "max_session_duration_seconds": "1800",
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            ASSEMBLYAI_TOKEN_URL,
            params=params,
            headers={"Authorization": f"Bearer {api_key}"},
        )

    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"AssemblyAI token error: {resp.text}")

    return {"token": resp.json()["token"]}


class SearchRequest(BaseModel):
    query: str


@app.post("/api/tool/search_web")
async def search_web(req: SearchRequest):
    api_key = os.environ.get("EXA_API_KEY")
    if not api_key:
        raise HTTPException(500, "EXA_API_KEY is not set on the server")

    payload = {
        "query": req.query,
        "numResults": 3,
        "type": "fast",
        "contents": {"highlights": {"maxCharacters": 500}},
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            EXA_SEARCH_URL,
            json=payload,
            headers={"x-api-key": api_key, "Content-Type": "application/json"},
        )

    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"Exa search error: {resp.text}")

    data = resp.json()
    results = []
    for r in data.get("results", [])[:3]:
        highlights = r.get("highlights") or []
        snippet = " ".join(h.strip() for h in highlights if h).replace("\n", " ")
        if not snippet:
            snippet = (r.get("text") or "").strip().replace("\n", " ")
        if len(snippet) > 400:
            snippet = snippet[:400] + "…"
        results.append(
            {
                "title": r.get("title") or "",
                "source": urlparse(r.get("url") or "").netloc,
                "url": r.get("url") or "",
                "published": r.get("publishedDate") or "",
                "snippet": snippet,
            }
        )
    return {"query": req.query, "results": results}


class Turn(BaseModel):
    role: str  # "user" | "agent" | "tool"
    text: str


class GeneratePostRequest(BaseModel):
    turns: list[Turn]
    angle: str | None = None


POST_SYSTEM_PROMPT = """You write a single LinkedIn post in the user's own voice, based on a transcript of a short interview.

The post must sound like the USER wrote it themselves — not the INTERVIEWER, not a generic LinkedIn ghostwriter, not you. Mirror the user's vocabulary, sentence rhythm, energy, and any quirks (sentence fragments, all-lowercase, em dashes, signature phrases). If they swore, keep the swear. If they spoke like an engineer, keep that. If they were warm and rambly, keep that.

Anchor the post on a specific story, moment, number, or quote from the transcript — never an abstract take. Search results in the transcript (lines starting with SEARCH) are factual references the user already saw and accepted; you may weave a number or fact from them in if it strengthens the post, but don't invent statistics.

Hard rules:
- 100–220 words. Plain text, line breaks for rhythm.
- No emoji unless the user used them in the transcript.
- No "I'm excited / humbled / thrilled to announce", no "🚀", no "Here's what I learned:" listicles, no asking the reader to "drop a 👍".
- No hashtags unless the user named one.
- Don't open with the literal word "I" if a more concrete first line is available.
- End on a line that earns the takeaway — don't tack on a generic question.

Output only the post body. No preamble, no headers, no quotes around it."""


def _format_transcript(turns: list[Turn]) -> str:
    lines: list[str] = []
    for t in turns:
        text = (t.text or "").strip()
        if not text:
            continue
        if t.role == "user":
            lines.append(f"USER: {text}")
        elif t.role == "agent":
            lines.append(f"INTERVIEWER: {text}")
        elif t.role == "tool":
            lines.append(f"SEARCH: {text}")
    return "\n".join(lines)


@app.post("/api/tool/generate_post")
async def generate_post(req: GeneratePostRequest):
    api_key = os.environ.get("ASSEMBLYAI_API_KEY")
    if not api_key:
        raise HTTPException(500, "ASSEMBLYAI_API_KEY is not set on the server")

    transcript = _format_transcript(req.turns)
    if not transcript:
        raise HTTPException(400, "transcript is empty")

    user_msg = (
        f"Interview transcript:\n\n{transcript}\n\n"
        "Write the LinkedIn post now, in the USER's voice."
    )
    if req.angle:
        user_msg += f"\n\nAngle hint from the interview: {req.angle}"

    payload = {
        "model": LLM_GATEWAY_MODEL,
        "messages": [
            {"role": "system", "content": POST_SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        "max_tokens": 1024,
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            LLM_GATEWAY_URL,
            json=payload,
            headers={"Authorization": api_key, "Content-Type": "application/json"},
        )

    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"LLM Gateway error: {resp.text}")

    data = resp.json()
    try:
        post = data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError):
        raise HTTPException(502, f"Unexpected LLM Gateway response: {data}")

    return {"post": post, "model": LLM_GATEWAY_MODEL}
