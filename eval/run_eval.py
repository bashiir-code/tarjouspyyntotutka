"""Evaluate retrieval (BM25 vs vector vs hybrid vs hybrid+semantic) and agent groundedness.

Usage:
  python eval/run_eval.py                 # retrieval only (cheap, runs in CI)
  python eval/run_eval.py --agent         # + agent groundedness on eval/agent.jsonl
  python eval/run_eval.py --min-recall 0.7  # fail (exit 1) if hybrid+semantic recall@5 drops below
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from hilma.search import get_notice, search_notices  # noqa: E402

HERE = Path(__file__).parent
MODES = ["bm25", "vector", "hybrid", "semantic"]


def retrieval(k: int = 10) -> dict:
    rows = [json.loads(line) for line in (HERE / "retrieval.jsonl").read_text().splitlines() if line.strip()]
    stats = {m: {"r1": 0, "r5": 0, "r10": 0, "mrr": 0.0} for m in MODES}
    misses = {m: [] for m in MODES}
    for row in rows:
        for m in MODES:
            ids = [r["id"] for r in search_notices(row["question"], top=k, mode=m)]
            rank = ids.index(row["id"]) + 1 if row["id"] in ids else None
            s = stats[m]
            s["r1"] += rank == 1
            s["r5"] += bool(rank and rank <= 5)
            s["r10"] += bool(rank)
            s["mrr"] += 1 / rank if rank else 0
            if not rank or rank > 5:
                misses[m].append({"q": row["question"], "want": row["title"][:70], "rank": rank})
    n = len(rows)
    report = {m: {"recall@1": s["r1"] / n, "recall@5": s["r5"] / n, "recall@10": s["r10"] / n, "mrr@10": s["mrr"] / n} for m, s in stats.items()}
    print(f"\nRetrieval, {n} known-item queries")
    print(f"{'mode':<10}{'R@1':>8}{'R@5':>8}{'R@10':>8}{'MRR':>8}")
    for m, r in report.items():
        print(f"{m:<10}{r['recall@1']:>8.2f}{r['recall@5']:>8.2f}{r['recall@10']:>8.2f}{r['mrr@10']:>8.2f}")
    return {"metrics": report, "misses": misses}


def groundedness() -> dict:
    """Citation validity: every [HILMA id] the agent cites must exist and must have been retrieved by a
    tool in that same run (no citing from memory). Stated deadlines must match the cited notice."""
    from hilma.agent import run

    rows = [json.loads(line) for line in (HERE / "agent.jsonl").read_text().splitlines() if line.strip()]
    results = []
    for row in rows:
        out = run(row["question"])
        cited, retrieved = out["sources"], set(out["retrieved"])
        exists = [c for c in cited if get_notice(c)]
        from_tools = [c for c in cited if c in retrieved]
        expected_hit = bool(set(row.get("expect_any", [])) & set(cited)) if row.get("expect_any") else None
        # Constraint check: a cited notice with a known value must respect the user's value limit.
        # Notices with no stated value are allowed (the agent is told to say the value is missing).
        violations = None
        if row.get("max_value") is not None:
            violations = [
                c for c in exists
                if (v := get_notice(c).get("estimated_value")) is not None and v > row["max_value"]
            ]
        results.append(
            {
                "question": row["question"],
                "cited": len(cited),
                "cited_exist": len(exists) == len(cited),
                "cited_from_tools": len(from_tools) == len(cited),
                "expected_hit": expected_hit,
                "constraint_ok": (not violations) if violations is not None else None,
                "violations": violations,
            }
        )
        print(json.dumps(results[-1], ensure_ascii=False))
    n = len(results)
    summary = {
        "answers_with_citations": sum(r["cited"] > 0 for r in results) / n,
        "citation_validity": sum(r["cited_exist"] and r["cited_from_tools"] for r in results) / n,
    }
    hits = [r["expected_hit"] for r in results if r["expected_hit"] is not None]
    if hits:
        summary["expected_notice_cited"] = sum(hits) / len(hits)
    constrained = [r["constraint_ok"] for r in results if r["constraint_ok"] is not None]
    if constrained:
        summary["respects_value_limit"] = sum(constrained) / len(constrained)
    print("\nAgent groundedness:", json.dumps(summary, indent=1))
    return {"summary": summary, "rows": results}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--agent", action="store_true")
    ap.add_argument("--min-recall", type=float, default=None)
    args = ap.parse_args()
    report = {"retrieval": retrieval()}
    if args.agent:
        report["agent"] = groundedness()
    (HERE / "results.json").write_text(json.dumps(report, ensure_ascii=False, indent=1))
    if args.min_recall is not None and report["retrieval"]["metrics"]["semantic"]["recall@5"] < args.min_recall:
        print(f"FAIL: semantic recall@5 below {args.min_recall}")
        sys.exit(1)


if __name__ == "__main__":
    main()
