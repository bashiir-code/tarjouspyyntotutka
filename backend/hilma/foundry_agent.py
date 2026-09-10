"""Tarjouspyyntötutka on Foundry Agent Service (prompt agent + client-side function tools).

The agent definition (model, instructions, tool schemas) lives server-side in the Foundry project;
conversations are stored there too. Our code only executes the three function tools. Auth is Entra ID
(az login locally, managed identity in Azure) - no API keys for the agent path.
"""

import json
import os
import re
from datetime import date

import httpx
from azure.identity import DefaultAzureCredential
from openai import OpenAI

from .agent import SYSTEM, TOOLS, _call_tool, extract_constraints

PROJECT_ENDPOINT = os.environ["FOUNDRY_PROJECT_ENDPOINT"].rstrip("/")
AGENT_NAME = os.environ.get("FOUNDRY_AGENT_NAME", "tarjouspyyntotutka")
MODEL = os.environ.get("CHAT_DEPLOYMENT", "gpt-5-mini")
MAX_STEPS = 10

_cred = DefaultAzureCredential()

# The system prompt embeds today's date; on the server-side agent we keep instructions static
# and pass date + enforced constraints per request instead.
INSTRUCTIONS = re.sub(r" Tänään on \S+\.", "", SYSTEM)

# Chat Completions nests tools under "function"; Responses/agents use a flat shape.
AGENT_TOOLS = [{"type": "function", **t["function"]} for t in TOOLS]


def _token() -> str:
    return _cred.get_token("https://ai.azure.com/.default").token


def _client() -> OpenAI:
    return OpenAI(base_url=f"{PROJECT_ENDPOINT}/openai/v1", api_key=_token())


def deploy_agent() -> dict:
    """Create a new agent version from the current code-defined prompt and tools (idempotent to rerun)."""
    body = {"definition": {"kind": "prompt", "model": MODEL, "instructions": INSTRUCTIONS, "tools": AGENT_TOOLS}}
    headers = {"Authorization": f"Bearer {_token()}"}
    r = httpx.post(f"{PROJECT_ENDPOINT}/agents/{AGENT_NAME}/versions?api-version=v1", json=body, headers=headers, timeout=60)
    if r.status_code == 404:  # first deploy: agent doesn't exist yet
        r = httpx.post(f"{PROJECT_ENDPOINT}/agents?api-version=v1", json={"name": AGENT_NAME, **body}, headers=headers, timeout=60)
    r.raise_for_status()
    return r.json()


def run(question: str, conversation_id: str | None = None) -> dict:
    """Same return shape as agent.run, plus conversation_id for multi-turn (history is kept server-side)."""
    client = _client()
    agent_ref = {"agent_reference": {"name": AGENT_NAME, "type": "agent_reference"}}
    if not conversation_id:
        conversation_id = client.conversations.create().id

    constraints = extract_constraints(question)
    context = f"[Tänään on {date.today().isoformat()}."
    if constraints:
        context += f" Käyttäjän rajaukset, pakotetaan jokaiseen hakuun: {json.dumps(constraints)}"
    user_input = [{"type": "message", "role": "user", "content": f"{context}]\n\n{question}"}]

    trace, retrieved = [], []
    response = client.responses.create(input=user_input, conversation=conversation_id, extra_body=agent_ref)
    for _ in range(MAX_STEPS):
        calls = [item for item in response.output if item.type == "function_call"]
        if not calls:
            break
        outputs = []
        for call in calls:
            args = json.loads(call.arguments or "{}")
            result = _call_tool(call.name, args, constraints)
            ids = [r["id"] for r in result] if isinstance(result, list) else [result.get("id")] if isinstance(result, dict) else []
            retrieved += [i for i in ids if i]
            trace.append({"tool": call.name, "args": args, "result_ids": ids})
            outputs.append(
                {"type": "function_call_output", "call_id": call.call_id, "output": json.dumps(result, ensure_ascii=False, default=str)[:30000]}
            )
        response = client.responses.create(input=outputs, conversation=conversation_id, extra_body=agent_ref)
    else:
        return {"answer": "En saanut vastausta valmiiksi askelrajan sisällä.", "trace": trace, "sources": [], "retrieved": retrieved, "conversation_id": conversation_id}

    answer = response.output_text
    cited = re.findall(r"\[HILMA (\d+)\]", answer or "")
    return {
        "answer": answer,
        "constraints": constraints,
        "trace": trace,
        "sources": list(dict.fromkeys(cited)),
        "retrieved": list(dict.fromkeys(retrieved)),
        "conversation_id": conversation_id,
    }


if __name__ == "__main__":
    import sys

    if sys.argv[1:] == ["deploy"]:
        a = deploy_agent()
        print(f"Deployed agent {a.get('name')} version {a.get('version')}")
    else:
        out = run(" ".join(sys.argv[1:]) or "Onko viimeisen puolen vuoden aikana tullut Azure-osaamiseen liittyviä kilpailutuksia, joiden arvo on alle 500 000 €?")
        print(out["answer"])
        print("\n--- trace ---")
        for t in out["trace"]:
            print(t)
