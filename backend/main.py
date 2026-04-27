import os

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

ASSEMBLYAI_TOKEN_URL = "https://agents.assemblyai.com/v1/token"

app = FastAPI(title="Voice Agent API Demo")

allowed_origins = os.environ.get(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in allowed_origins if o.strip()],
    allow_methods=["GET"],
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
