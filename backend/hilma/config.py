import os

from dotenv import load_dotenv

load_dotenv()

HILMA_API_KEY = os.environ.get("HILMA_API_KEY", "")
HILMA_BASE_URL = os.environ.get("HILMA_BASE_URL", "https://api.hankintailmoitukset.fi/avp")

FOUNDRY_ENDPOINT = os.environ["FOUNDRY_ENDPOINT"]
FOUNDRY_API_KEY = os.environ["FOUNDRY_API_KEY"]
CHAT_DEPLOYMENT = os.environ.get("CHAT_DEPLOYMENT", "gpt-5-mini")
EMBEDDING_DEPLOYMENT = os.environ.get("EMBEDDING_DEPLOYMENT", "text-embedding-3-small")
EMBEDDING_DIM = 1536

SEARCH_ENDPOINT = os.environ["SEARCH_ENDPOINT"]
SEARCH_API_KEY = os.environ["SEARCH_API_KEY"]
SEARCH_INDEX = os.environ.get("SEARCH_INDEX", "hilma-notices")
