"""One-off: dump a sample HILMA search response so we can map the real schema."""

import json
import sys
from pathlib import Path

import httpx

from . import config

OUT = Path("data/sample")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    body = {"search": sys.argv[1] if len(sys.argv) > 1 else "*", "top": 3, "count": True}
    r = httpx.post(
        f"{config.HILMA_BASE_URL}/eformnotices/docs/search",
        headers={"Ocp-Apim-Subscription-Key": config.HILMA_API_KEY},
        json=body,
        timeout=30,
    )
    print(r.status_code)
    r.raise_for_status()
    data = r.json()
    (OUT / "search.json").write_text(json.dumps(data, ensure_ascii=False, indent=2))
    print("count:", data.get("@odata.count"))
    first = (data.get("value") or [{}])[0]
    for k, v in first.items():
        print(f"{k}: {str(v)[:120]!r}")


if __name__ == "__main__":
    main()
