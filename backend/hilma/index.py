"""Create the hybrid search index: Finnish BM25 + vectors + semantic ranker."""

from azure.core.credentials import AzureKeyCredential
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    AzureOpenAIVectorizer,
    AzureOpenAIVectorizerParameters,
    HnswAlgorithmConfiguration,
    SearchableField,
    SearchField,
    SearchFieldDataType,
    SearchIndex,
    SemanticConfiguration,
    SemanticField,
    SemanticPrioritizedFields,
    SemanticSearch,
    SimpleField,
    VectorSearch,
    VectorSearchProfile,
)

from . import config

FI = "fi.microsoft"  # lemmatizing Finnish analyzer: handles inflection + compound splitting


def build_index() -> SearchIndex:
    S = SearchFieldDataType
    fields = [
        SimpleField(name="id", type=S.String, key=True, filterable=True),
        SearchableField(name="title", type=S.String, analyzer_name=FI),
        SearchableField(name="description", type=S.String, analyzer_name=FI),
        SearchableField(name="content", type=S.String, analyzer_name=FI),
        SearchableField(name="buyer", type=S.String, analyzer_name=FI, filterable=True, facetable=True),
        SimpleField(name="buyer_city", type=S.String, filterable=True, facetable=True),
        SimpleField(name="cpv_codes", type=S.Collection(S.String), filterable=True, facetable=True),
        SimpleField(name="main_cpv", type=S.String, filterable=True, facetable=True),
        SimpleField(name="estimated_value", type=S.Double, filterable=True, sortable=True),
        SimpleField(name="currency", type=S.String, filterable=True),
        SimpleField(name="deadline", type=S.DateTimeOffset, filterable=True, sortable=True),
        SimpleField(name="published", type=S.DateTimeOffset, filterable=True, sortable=True),
        SimpleField(name="notice_type", type=S.String, filterable=True, facetable=True),
        SimpleField(name="procedure_type", type=S.String, filterable=True, facetable=True),
        SimpleField(name="url", type=S.String),
        SearchField(
            name="content_vector",
            type=S.Collection(S.Single),
            searchable=True,
            vector_search_dimensions=config.EMBEDDING_DIM,
            vector_search_profile_name="vec",
        ),
    ]
    vector_search = VectorSearch(
        algorithms=[HnswAlgorithmConfiguration(name="hnsw")],
        profiles=[VectorSearchProfile(name="vec", algorithm_configuration_name="hnsw", vectorizer_name="aoai")],
        vectorizers=[
            AzureOpenAIVectorizer(
                vectorizer_name="aoai",
                parameters=AzureOpenAIVectorizerParameters(
                    resource_url=config.FOUNDRY_ENDPOINT.rstrip("/"),
                    deployment_name=config.EMBEDDING_DEPLOYMENT,
                    model_name=config.EMBEDDING_DEPLOYMENT,
                    api_key=config.FOUNDRY_API_KEY,
                ),
            )
        ],
    )
    semantic = SemanticSearch(
        default_configuration_name="default",
        configurations=[
            SemanticConfiguration(
                name="default",
                prioritized_fields=SemanticPrioritizedFields(
                    title_field=SemanticField(field_name="title"),
                    content_fields=[SemanticField(field_name="description"), SemanticField(field_name="content")],
                    keywords_fields=[SemanticField(field_name="buyer")],
                ),
            )
        ],
    )
    return SearchIndex(name=config.SEARCH_INDEX, fields=fields, vector_search=vector_search, semantic_search=semantic)


def main() -> None:
    client = SearchIndexClient(config.SEARCH_ENDPOINT, AzureKeyCredential(config.SEARCH_API_KEY))
    idx = client.create_or_update_index(build_index())
    print(f"Index ready: {idx.name} ({len(idx.fields)} fields)")


if __name__ == "__main__":
    main()
