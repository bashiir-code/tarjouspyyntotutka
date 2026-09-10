"""Fetch ICT/consulting eForms notices from HILMA AVP, embed, and push to Azure AI Search."""

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient
from openai import AzureOpenAI

from . import config

RAW = Path(__file__).resolve().parents[2] / "data" / "raw" / "notices.json"
# 72 = IT services, 48 = software packages, 794 = business/management consulting
CPV_PREFIXES = ("72", "48", "794")
PAGE = 1000
EMBED_CHARS = 8000


def fetch(days: int = 365) -> list[dict]:
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT00:00:00Z")
    flt = f"isEForms eq true and mainType eq 'ContractNotices' and datePublished ge {since}"
    docs, skip = [], 0
    with httpx.Client(headers={"Ocp-Apim-Subscription-Key": config.HILMA_API_KEY}, timeout=60) as http:
        while True:
            r = http.post(
                f"{config.HILMA_BASE_URL}/eformnotices/docs/search",
                json={"search": "*", "filter": flt, "top": PAGE, "skip": skip, "count": True, "orderby": "datePublished desc"},
            )
            r.raise_for_status()
            batch = r.json()["value"]
            docs += batch
            print(f"fetched {len(docs)} / {r.json().get('@odata.count')}")
            if len(batch) < PAGE:
                return docs
            skip += PAGE


def all_cpvs(n: dict) -> list[str]:
    codes = set((n.get("cpvCodes") or "").split())
    for lot in n.get("lots") or []:
        codes |= set((lot.get("cpvCodes") or "").split())
    return sorted(codes)


def is_relevant(n: dict) -> bool:
    return not n.get("isCancelled") and any(c.startswith(CPV_PREFIXES) for c in all_cpvs(n))


def to_doc(n: dict) -> dict:
    cpvs = all_cpvs(n)
    # Store prefixes too so the agent can filter "cpv_codes/any(c: c eq '72')"
    expanded = sorted({c[:k] for c in cpvs for k in (2, 3, 4)} | set(cpvs))
    lots = n.get("lots") or []
    lot_text = "\n\n".join(
        f"Osa {lot.get('id')}: {lot.get('titleFi') or ''}\n{lot.get('descriptionFi') or ''}"
        for lot in lots
        if lot.get("descriptionFi") and lot.get("descriptionFi") != n.get("descriptionFi")
    )
    value = n.get("estimatedValue") or n.get("overallApproximateFrameworkContractsAmount") or None
    return {
        "id": str(n["noticeId"]),
        "title": n.get("titleFi") or n.get("titleEn") or n.get("titleSv") or "",
        "description": n.get("descriptionFi") or n.get("descriptionEn") or "",
        "content": lot_text,
        "buyer": n.get("organisationNameFi") or n.get("organisationNameEn") or "",
        "buyer_city": n.get("organisationNutsCode") or "",
        "cpv_codes": expanded,
        "main_cpv": cpvs[0] if cpvs else "",
        "estimated_value": float(value) if value else None,
        "currency": n.get("currency") or "",
        "deadline": n.get("deadline"),
        "published": n.get("datePublished"),
        "notice_type": n.get("type") or "",
        "procedure_type": n.get("procedureType") or "",
        "url": f"https://www.hankintailmoitukset.fi/fi/public/procedure/{n['procedureId']}/enotice/{n['noticeId']}/",
    }


def embed(docs: list[dict]) -> None:
    client = AzureOpenAI(azure_endpoint=config.FOUNDRY_ENDPOINT, api_key=config.FOUNDRY_API_KEY, api_version="2024-10-21")
    for i in range(0, len(docs), 64):
        chunk = docs[i : i + 64]
        texts = [f"{d['title']}\n{d['buyer']}\n{d['description']}\n{d['content']}"[:EMBED_CHARS] for d in chunk]
        resp = client.embeddings.create(model=config.EMBEDDING_DEPLOYMENT, input=texts)
        for d, e in zip(chunk, resp.data):
            d["content_vector"] = e.embedding
        print(f"embedded {i + len(chunk)} / {len(docs)}")


def main() -> None:
    if RAW.exists():
        raw = json.loads(RAW.read_text())
    else:
        raw = fetch()
        RAW.parent.mkdir(parents=True, exist_ok=True)
        RAW.write_text(json.dumps(raw, ensure_ascii=False))
    docs = [to_doc(n) for n in raw if is_relevant(n)]
    print(f"{len(raw)} contract notices -> {len(docs)} ICT/consulting")
    embed(docs)
    search = SearchClient(config.SEARCH_ENDPOINT, config.SEARCH_INDEX, AzureKeyCredential(config.SEARCH_API_KEY))
    for i in range(0, len(docs), 100):
        res = search.upload_documents(docs[i : i + 100])
        print(f"uploaded {i + len(res)}, failed {sum(not r.succeeded for r in res)}")


if __name__ == "__main__":
    main()
