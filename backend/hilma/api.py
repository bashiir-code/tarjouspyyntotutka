"""FastAPI backend: /api/ask for the agent, /api/notices/{id} for detail view."""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import agent
from .search import get_notice, search_notices

app = FastAPI(title="Tarjouspyyntötutka")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class Ask(BaseModel):
    question: str
    history: list[dict] = []


@app.post("/api/ask")
def ask(body: Ask):
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
