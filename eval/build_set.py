"""Build the retrieval eval set (run once, then commit eval/retrieval.jsonl and review it by hand).

Known-item method: sample 30 indexed notices, and for each have the LLM write the question a
salesperson would ask *without* reusing the notice's own word forms (other inflections, split or
joined compounds, synonyms). That is exactly what breaks naive tokenisation in Finnish, so the set
measures the morphology problem instead of rewarding exact keyword overlap.
"""

import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from hilma import config  # noqa: E402
from hilma.ingest import RAW, is_relevant, to_doc  # noqa: E402
from openai import AzureOpenAI  # noqa: E402

OUT = Path(__file__).parent / "retrieval.jsonl"
N = 30

PROMPT = """Alla on julkinen hankintailmoitus. Kirjoita YKSI suomenkielinen kysymys, jonka IT-konsulttitalon
myyjä voisi esittää hakutyökalulle löytääkseen juuri tämän ilmoituksen.
Säännöt:
- Älä kopioi otsikon sanoja sellaisenaan: käytä eri taivutusmuotoja, pura tai yhdistä yhdyssanoja,
  tai käytä synonyymejä (esim. "tietojärjestelmähankinta" -> "järjestelmän hankkiminen").
- Kuvaa tarve, älä hankintayksikön nimeä.
- Enintään 20 sanaa.
Palauta JSON: {"question": "...", "variation": "mitä sanamuotoja muutit"}

OTSIKKO: {title}
KUVAUS: {description}"""


def main() -> None:
    raw = json.loads(RAW.read_text())
    docs = [to_doc(n) for n in raw if is_relevant(n)]
    random.Random(42).shuffle(docs)
    llm = AzureOpenAI(azure_endpoint=config.FOUNDRY_ENDPOINT, api_key=config.FOUNDRY_API_KEY, api_version="2024-10-21")
    with OUT.open("w") as f:
        for d in docs[:N]:
            resp = llm.chat.completions.create(
                model=config.CHAT_DEPLOYMENT,
                response_format={"type": "json_object"},
                messages=[{"role": "user", "content": PROMPT.replace("{title}", d["title"]).replace("{description}", d["description"][:1500])}],
            )
            q = json.loads(resp.choices[0].message.content)
            row = {"id": d["id"], "title": d["title"], "question": q["question"], "variation": q.get("variation", "")}
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
            print(row["question"], "->", d["title"][:60])


if __name__ == "__main__":
    main()
