"""Embedding service stub.

Replace the body of ``embed_and_upsert`` when the vector DB integration
is wired. The interface is stable: receive a list of
DocumentParagraphRecord instances and a document_id; return a stats dict.
"""
import logging

logger = logging.getLogger(__name__)


def embed_and_upsert(paragraph_records: list, document_id) -> dict:
    """Embed *paragraph_records* and upsert them into the Vector DB.

    Parameters
    ----------
    paragraph_records : list[DocumentParagraphRecord]
    document_id       : UUID / str

    Returns
    -------
    dict with keys: embedded (int), failed (int)
    """
    # TODO: replace with real embedding call (e.g. OpenAI, Bedrock Titan,
    # Cohere, etc.) and pgvector / Pinecone upsert.
    logger.info(
        'embedding_service.embed_and_upsert: STUB called for %d records (doc=%s)',
        len(paragraph_records), document_id,
    )
    return {'embedded': len(paragraph_records), 'failed': 0}
