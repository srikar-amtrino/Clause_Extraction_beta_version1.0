"""Generate paragraph embeddings through the configured API and upsert to Qdrant."""
import logging
import os

import requests

logger = logging.getLogger(__name__)


def _required_env(name):
    value = os.environ.get(name, '').strip()
    if not value:
        raise RuntimeError(f'{name} must be configured to publish vectors.')
    return value


def _embedding_vectors(response_data, expected_count):
    vectors = response_data.get('embeddings')
    if vectors is None and isinstance(response_data.get('data'), list):
        vectors = [item.get('embedding') for item in response_data['data']]
    if not isinstance(vectors, list) or len(vectors) != expected_count:
        raise RuntimeError('Embedding API returned an unexpected number of embeddings.')
    if any(not isinstance(vector, list) or not vector for vector in vectors):
        raise RuntimeError('Embedding API returned an invalid embedding vector.')
    dimensions = {len(vector) for vector in vectors}
    if len(dimensions) != 1:
        raise RuntimeError('Embedding API returned vectors with inconsistent dimensions.')
    return vectors


def count_document_vectors(document_id) -> int:
    """Return the exact number of Qdrant points currently stored for a document."""
    qdrant_url = _required_env('QDRANT_URL').rstrip('/')
    qdrant_api_key = _required_env('QDRANT_API_KEY')
    collection = os.environ.get('QDRANT_COLLECTION', 'legal_clauses_v1').strip()
    timeout = float(os.environ.get('EMBEDDING_API_TIMEOUT_SECONDS', '60'))
    response = requests.post(
        f'{qdrant_url}/collections/{collection}/points/count',
        json={
            'exact': True,
            'filter': {
                'must': [
                    {'key': 'document_id', 'match': {'value': str(document_id)}}
                ],
            },
        },
        headers={'api-key': qdrant_api_key, 'Content-Type': 'application/json'},
        timeout=timeout,
    )
    response.raise_for_status()
    count = response.json().get('result', {}).get('count')
    if not isinstance(count, int):
        raise RuntimeError('Qdrant returned an invalid document point count.')
    return count


def delete_points(point_ids) -> int:
    """Delete points from Qdrant by id. An id Qdrant does not hold is ignored,
    so deleting twice is harmless. Returns how many ids were sent."""
    point_ids = [str(point_id) for point_id in point_ids]
    if not point_ids:
        return 0
    qdrant_url = _required_env('QDRANT_URL').rstrip('/')
    qdrant_api_key = _required_env('QDRANT_API_KEY')
    collection = os.environ.get('QDRANT_COLLECTION', 'legal_clauses_v1').strip()
    timeout = float(os.environ.get('EMBEDDING_API_TIMEOUT_SECONDS', '60'))
    for batch_start in range(0, len(point_ids), 64):
        response = requests.post(
            f'{qdrant_url}/collections/{collection}/points/delete?wait=true',
            json={'points': point_ids[batch_start:batch_start + 64]},
            headers={'api-key': qdrant_api_key, 'Content-Type': 'application/json'},
            timeout=timeout,
        )
        response.raise_for_status()
    logger.info('Deleted %d paragraph vectors from Qdrant.', len(point_ids))
    return len(point_ids)


def embed_and_upsert(paragraph_records: list, document_id) -> dict:
    """Embed all selected records, then upsert them into Qdrant in batches.

    Parameters
    ----------
    paragraph_records : list[DocumentParagraphRecord]
    document_id       : UUID / str

    Returns
    -------
    dict with keys: embedded (int), failed (int)
    """
    if not paragraph_records:
        return {'embedded': 0, 'failed': 0}

    embedding_url = 'http://54.215.196.139:8000/embed'
    qdrant_url = _required_env('QDRANT_URL').rstrip('/')
    qdrant_api_key = _required_env('QDRANT_API_KEY')
    collection = os.environ.get('QDRANT_COLLECTION', 'legal_clauses_v1').strip()
    # Four texts completed in about 11 seconds; larger batches exceeded the
    # EC2 service's 60-second client timeout in production.
    batch_size = min(4, max(1, int(os.environ.get('EMBEDDING_BATCH_SIZE', '4'))))
    timeout = float(os.environ.get('EMBEDDING_API_TIMEOUT_SECONDS', '60'))
    count_before = count_document_vectors(document_id)

    points = []
    for batch_start in range(0, len(paragraph_records), batch_size):
        batch = paragraph_records[batch_start:batch_start + batch_size]
        texts = [record.reviewed_text for record in batch]
        embedding_response = requests.post(
            embedding_url,
            json={'texts': texts},
            headers={'Accept': '*/*'},
            timeout=timeout,
        )
        embedding_response.raise_for_status()
        vectors = _embedding_vectors(embedding_response.json(), len(batch))

        for record, vector in zip(batch, vectors):
            chunk = record.chunk if record.chunk_id else None
            chunk_id = getattr(chunk, 'local_id', None) or record.paragraph_id
            vector_id = f'{document_id}::{chunk_id}'
            document = record.document
            breadcrumb = record.breadcrumb or (
                [chunk.breadcrumb] if chunk and chunk.breadcrumb else []
            )
            points.append({
                'id': str(record.pk),
                'vector': {'dense': vector},
                'payload': {
                    'vector_id': vector_id,
                    'chunk_id': chunk_id,
                    'document_id': str(document_id),
                    'document_name': document.name,
                    'run_id': str(chunk.chunk_run_id) if chunk else None,
                    'parent_id': chunk.parent_local_id if chunk else None,
                    'chunk_kind': chunk.kind if chunk else None,
                    'paragraph_id': record.paragraph_id,
                    'text': record.reviewed_text,
                    'embed_text': record.reviewed_text,
                    'breadcrumb': breadcrumb,
                    'source_page': record.source_page,
                    'label': record.label,
                    'canonical_type': record.canonical_type,
                    'sub_type': record.sub_type,
                    'confidence': record.confidence,
                    'embedding_model': 'BAAI/bge-m3',
                    'embedding_dim': len(vector),
                    'max_length': 1024,
                },
            })

    for batch_start in range(0, len(points), 64):
        qdrant_response = requests.put(
            f'{qdrant_url}/collections/{collection}/points?wait=true',
            json={'points': points[batch_start:batch_start + 64]},
            headers={'api-key': qdrant_api_key, 'Content-Type': 'application/json'},
            timeout=timeout,
        )
        qdrant_response.raise_for_status()

    count_after = count_document_vectors(document_id)
    added = max(0, count_after - count_before)
    updated = max(0, len(points) - added)
    logger.info('Upserted %d paragraph vectors for document %s.', len(points), document_id)
    return {
        'embedded': len(points),
        'failed': 0,
        'count_before': count_before,
        'count_after': count_after,
        'added': added,
        'updated': updated,
    }
