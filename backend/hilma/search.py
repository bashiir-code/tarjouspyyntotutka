"""Hybrid retrieval: BM25 (fi.microsoft) + vector + semantic rerank, with structured filters."""

from datetime import datetime

from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizableTextQuery

from . import config

_client = SearchClient(config.SEARCH_ENDPOINT, config.SEARCH_INDEX, AzureKeyCredential(config.SEARCH_API_KEY))

SUMMARY_FIELDS = ["id", "title", "buyer", "estimated_value", "currency", "deadline", "published", "main_cpv", "url"]


def _odata_str(s: str) -> str:
    return s.replace("'", "''")


def build_filter(
    max_value: float | None = None,
    min_value: float | None = None,
    published_after: str | None = None,
    deadline_after: str | None = None,
    cpv_prefix: str | None = None,
    buyer: str | None = None,
) -> str | None:
    parts = []
    if max_value is not None:
        parts.append(f"estimated_value le {max_value}")
    if min_value is not None:
        parts.append(f"estimated_value ge {min_value}")
    if published_after:
        parts.append(f"published ge {datetime.fromisoformat(published_after).strftime('%Y-%m-%dT00:00:00Z')}")
    if deadline_after:
        parts.append(f"deadline ge {datetime.fromisoformat(deadline_after).strftime('%Y-%m-%dT00:00:00Z')}")
    if cpv_prefix:
        # cpv_codes holds both full codes and 2/3/4-digit prefixes (see ingest), so equality works as prefix match
        parts.append(f"cpv_codes/any(c: c eq '{_odata_str(cpv_prefix)}')")
    if buyer:
        parts.append(f"search.ismatch('{_odata_str(buyer)}', 'buyer')")
    return " and ".join(parts) or None


def search_notices(query: str, top: int = 8, mode: str = "hybrid", min_score: float | None = None, **filters) -> list[dict]:
    """mode: 'bm25' | 'vector' | 'hybrid' | 'semantic' (hybrid + semantic rerank). Used by eval to compare.

    min_score (semantic mode only) drops weak reranker matches. Vector search always returns its
    k nearest neighbours, so without a floor an off-topic query still yields "results".
    """
    kwargs: dict = {"filter": build_filter(**filters), "top": top, "select": SUMMARY_FIELDS}
    if mode in ("vector", "hybrid", "semantic"):
        kwargs["vector_queries"] = [VectorizableTextQuery(text=query, k_nearest_neighbors=50, fields="content_vector")]
    if mode == "semantic":
        kwargs.update(query_type="semantic", semantic_configuration_name="default", query_caption="extractive")
    results = _client.search(search_text=None if mode == "vector" else query, **kwargs)
    out = []
    for r in results:
        doc = {k: r.get(k) for k in SUMMARY_FIELDS}
        doc["score"] = r.get("@search.reranker_score") or r.get("@search.score")
        if min_score is not None and mode == "semantic" and (r.get("@search.reranker_score") or 0) < min_score:
            continue
        caps = r.get("@search.captions")
        if caps:
            doc["caption"] = caps[0].text
        out.append(doc)
    return out


def get_notice(notice_id: str) -> dict | None:
    try:
        doc = _client.get_document(notice_id)
    except Exception:
        return None
    doc.pop("content_vector", None)
    return dict(doc)
