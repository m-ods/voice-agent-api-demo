import os
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

ASSEMBLYAI_TOKEN_URL = "https://agents.assemblyai.com/v1/token"
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
