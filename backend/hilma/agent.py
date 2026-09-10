"""Tarjouspyyntötutka agent: tool-calling loop over search / read / assess_fit."""

import json
import re
from datetime import date
from pathlib import Path

from openai import AzureOpenAI

from . import config
from .search import get_notice, search_notices

PROFILE = (Path(__file__).parent / "profile.md").read_text()

_llm = AzureOpenAI(azure_endpoint=config.FOUNDRY_ENDPOINT, api_key=config.FOUNDRY_API_KEY, api_version="2024-10-21")

SYSTEM = f"""Olet Tarjouspyyntötutka, julkisten hankintojen analyytikko. Tänään on {date.today().isoformat()}.
Käytät vain työkalujen palauttamaa HILMA-dataa. Älä keksi ilmoituksia, arvoja tai määräaikoja.

Toimintatapa:
1. Muunna käyttäjän kysymys hauksi: poimi aihe hakusanoiksi ja rajaukset suodattimiksi
   (arvo -> max_value/min_value, aikaväli -> published_after, "vielä auki" -> deadline_after = tänään).
   Kokeile tarvittaessa useaa hakua (synonyymit, suomi/englanti, esim. "Azure", "pilvipalvelu", "Microsoft").
2. Lue lupaavimmat ilmoitukset get_notice-työkalulla ennen kuin väität niistä mitään yksityiskohtaista.
3. Jos kysytään sopivuutta, käytä assess_fit-työkalua.
4. Vastaa suomeksi. Jokaisesta ilmoituksesta: otsikko, hankintayksikkö, arvioitu arvo, määräaika,
   lyhyt perustelu ja lähdeviite muodossa [HILMA <id>](<url>). Jos arvo puuttuu, sano se.
   Jos mitään sopivaa ei löydy, sano se suoraan.
5. Käyttäjän rajaukset (arvo, aikaväli, auki olevat) ovat ehdottomia. Älä listaa ilmoitusta, jonka
   tiedetty arvo tai päivämäärä rikkoo rajauksen. Ilmoitukset, joiden arvoa ei ole ilmoitettu, saa
   mainita erillisenä "arvo ei tiedossa" -huomiona. Älä täytä vastausta aiheeseen liittymättömillä
   ilmoituksilla.
"""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_notices",
            "description": "Hybridihaku (suomen BM25 + vektori + semanttinen uudelleenjärjestys) HILMA ICT-/konsultointi-ilmoituksiin. Palauttaa tiivistelmät.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Hakulause, esim. 'Azure pilvipalvelut ylläpito'"},
                    "max_value": {"type": "number", "description": "Arvioitu arvo enintään (EUR, alv 0)"},
                    "min_value": {"type": "number"},
                    "published_after": {"type": "string", "description": "ISO-päivä, esim. 2026-03-10"},
                    "deadline_after": {"type": "string", "description": "ISO-päivä; tarjousaika päättyy tämän jälkeen"},
                    "cpv_prefix": {"type": "string", "description": "CPV-etuliite, esim. '72' (IT-palvelut), '48' (ohjelmistot), '794' (konsultointi)"},
                    "buyer": {"type": "string", "description": "Hankintayksikön nimi tai osa siitä"},
                    "top": {"type": "integer", "default": 8},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_notice",
            "description": "Lue yksittäinen ilmoitus kokonaan (kuvaus, osat, CPV:t, arvo, määräaika).",
            "parameters": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "assess_fit",
            "description": "Arvioi ilmoituksen sopivuus yrityksen kyvykkyysprofiiliin (0-100 + perustelut, riskit).",
            "parameters": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]},
        },
    },
]


def assess_fit(notice_id: str) -> dict:
    notice = get_notice(notice_id)
    if not notice:
        return {"error": f"Ilmoitusta {notice_id} ei löydy"}
    resp = _llm.chat.completions.create(
        model=config.CHAT_DEPLOYMENT,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": "Arvioi julkisen hankinnan sopivuus yritysprofiiliin. Palauta JSON: "
                '{"score": 0-100, "matching_capabilities": [..], "gaps": [..], "risks": [..], "recommendation": "tarjoa|harkitse|ohita", "reasoning": "..."}. '
                "Perustele vain ilmoituksen tekstin perusteella.",
            },
            {"role": "user", "content": f"PROFIILI:\n{PROFILE}\n\nILMOITUS:\n{json.dumps(notice, ensure_ascii=False, default=str)}"},
        ],
    )
    return {"id": notice_id, **json.loads(resp.choices[0].message.content)}


CONSTRAINT_KEYS = ("max_value", "min_value", "published_after", "deadline_after")


def extract_constraints(question: str) -> dict:
    """Pull the user's hard limits out once. The prompt alone did not stop the model from dropping
    max_value on retry searches (eval: an 800 k€ notice cited for a '< 5 000 €' question), so these are
    enforced in code on every search call instead of trusted to the model."""
    resp = _llm.chat.completions.create(
        model=config.CHAT_DEPLOYMENT,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": f"Tänään on {date.today().isoformat()}. Poimi kysymyksestä vain eksplisiittiset rajaukset JSONiksi: "
                '{"max_value": luku|null, "min_value": luku|null, "published_after": "YYYY-MM-DD"|null, "deadline_after": "YYYY-MM-DD"|null}. '
                "Arvot euroina. 'viimeisen puolen vuoden aikana' -> published_after. 'vielä auki' -> deadline_after = tänään. "
                "Jos rajausta ei mainita, null.",
            },
            {"role": "user", "content": question},
        ],
    )
    raw = json.loads(resp.choices[0].message.content)
    return {k: raw[k] for k in CONSTRAINT_KEYS if raw.get(k) is not None}


def _call_tool(name: str, args: dict, constraints: dict):
    if name == "search_notices":
        args = {**args, **constraints}  # user's limits win over whatever the model passed
        # 1.8: in eval, off-topic queries topped out at 1.47 and true known-item hits bottomed at 2.13
        return search_notices(mode="semantic", min_score=1.8, **args)
    if name == "get_notice":
        return get_notice(args["id"]) or {"error": "not found"}
    if name == "assess_fit":
        return assess_fit(args["id"])
    return {"error": f"unknown tool {name}"}


def run(question: str, history: list[dict] | None = None, max_steps: int = 8) -> dict:
    """Returns {'answer': str, 'trace': [tool calls], 'sources': [ids]}."""
    constraints = extract_constraints(question)
    system = SYSTEM + (f"\nKäyttäjän rajaukset (pakotetaan jokaiseen hakuun): {json.dumps(constraints)}" if constraints else "")
    messages = [{"role": "system", "content": system}, *(history or []), {"role": "user", "content": question}]
    trace, sources = [], []
    for _ in range(max_steps):
        resp = _llm.chat.completions.create(model=config.CHAT_DEPLOYMENT, messages=messages, tools=TOOLS)
        msg = resp.choices[0].message
        if not msg.tool_calls:
            cited = re.findall(r"\[HILMA (\d+)\]", msg.content or "")
            return {
                "answer": msg.content,
                "constraints": constraints,
                "trace": trace,
                "sources": list(dict.fromkeys(cited)),
                "retrieved": list(dict.fromkeys(sources)),
            }
        messages.append(msg.model_dump(exclude_none=True))
        for tc in msg.tool_calls:
            args = json.loads(tc.function.arguments or "{}")
            result = _call_tool(tc.function.name, args, constraints)
            ids = [r["id"] for r in result] if isinstance(result, list) else [result.get("id")] if isinstance(result, dict) else []
            sources += [i for i in ids if i]
            trace.append({"tool": tc.function.name, "args": args, "result_ids": ids})
            messages.append(
                {"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result, ensure_ascii=False, default=str)[:30000]}
            )
    return {"answer": "En saanut vastausta valmiiksi askelrajan sisällä.", "trace": trace, "sources": sources}


if __name__ == "__main__":
    import sys

    out = run(" ".join(sys.argv[1:]) or "Onko viimeisen puolen vuoden aikana tullut Azure-osaamiseen liittyviä kilpailutuksia, joiden arvo on alle 500 000 €?")
    print(out["answer"])
    print("\n--- trace ---")
    for t in out["trace"]:
        print(t)
