"""FastAPI backend: /api/ask for the agent, /api/notices/{id} for detail view."""

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import os

from . import agent
from .search import get_notice, search_notices

# AGENT_BACKEND=foundry (default): Foundry Agent Service, conversation kept server-side.
# AGENT_BACKEND=local: the original Chat Completions loop, kept for comparison in eval.
USE_FOUNDRY = os.environ.get("AGENT_BACKEND", "foundry") == "foundry"
if USE_FOUNDRY:
    from . import foundry_agent

app = FastAPI(title="Tarjouspyyntötutka")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(Exception)
async def upstream_error(_: Request, exc: Exception):
    # Almost every failure here is a downstream Azure dependency (Search, model, agent). Return 502 with
    # the reason so the UI can show it, instead of a bare 500.
    logging.exception("request failed")
    return JSONResponse(status_code=502, content={"detail": f"{type(exc).__name__}: {str(exc)[:300]}"})


class Ask(BaseModel):
    question: str
    history: list[dict] = []
    conversation_id: str | None = None


@app.post("/api/ask")
def ask(body: Ask):
    if USE_FOUNDRY:
        out = foundry_agent.run(body.question, body.conversation_id)
    else:
        out = agent.run(body.question, body.history)
    out["notices"] = [n for i in out["sources"][:12] if (n := get_notice(i))]
    for n in out["notices"]:
        n.pop("content", None)
    return out


@app.get("/api/notices/{notice_id}")
def notice(notice_id: str):
    n = get_notice(notice_id)
    if not n:
        raise HTTPException(404)
    return n


@app.get("/api/search")
def search(q: str, mode: str = "semantic", top: int = 10):
    return search_notices(q, top=top, mode=mode)


@app.get("/healthz")
def health():
    return {"ok": True}
