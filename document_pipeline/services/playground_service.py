"""Vector Playground service.

Embeds an ad-hoc clause text via the AWS EC2 BGE-M3 endpoint, then runs a
hybrid dense-BM25 search against the Qdrant collection, re-ranks the
candidates, and returns a classification verdict plus diagnostic data.

No database writes are performed -- this is a read-only diagnostic path.

Pipeline (mirrors application_layerv2.ipynb):
  1. Dense embed   - POST http://54.215.196.139:8000/embed
  2. Dense search  - Qdrant /query with "dense" named vector
  3. BM25 search   - in-process rank_bm25 against cached library payloads
  4. RRF blend     - reciprocal-rank fusion (k=60)
  5. Verdict       - resolve canonical_type from Postgres canonical_types table
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
import threading
import time
from typing import Any

import requests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
EMBEDDING_URL = os.environ.get("EMBEDDING_API_URL", "http://54.215.196.139:8000/embed")
EMBEDDING_TIMEOUT = float(os.environ.get("EMBEDDING_API_TIMEOUT_SECONDS", "60"))

RRF_K = 60
TOP_N = 10
CONFIDENCE_FLOOR = 0.50   # below this -> blindspot warning (Idea 1)


# ---------------------------------------------------------------------------
# BM25 index (lazy, thread-safe, rebuilt when Qdrant library size changes)
# ---------------------------------------------------------------------------
class _BM25Index:
    _lock = threading.Lock()
    _instance = None

    def __init__(self, payloads, collection_hash):
        try:
            from rank_bm25 import BM25Okapi
        except ImportError as exc:
            raise RuntimeError(
                "rank_bm25 is required for BM25 search. pip install rank-bm25"
            ) from exc
        self.payloads = payloads
        self.collection_hash = collection_hash
        tokenised = [_tokenize(p.get("text", "")) for p in payloads]
        self.bm25 = BM25Okapi(tokenised)

    @classmethod
    def get(cls, payloads, collection_hash):
        with cls._lock:
            if cls._instance is None or cls._instance.collection_hash != collection_hash:
                cls._instance = cls(payloads, collection_hash)
            return cls._instance


def _tokenize(text):
    return re.findall(r"[a-z]+", text.lower())


# ---------------------------------------------------------------------------
# Qdrant helpers (pure HTTP, no qdrant-client library)
# ---------------------------------------------------------------------------
def _qdrant_headers():
    h = {"Content-Type": "application/json"}
    key = os.environ.get("QDRANT_API_KEY", "")
    if key:
        h["api-key"] = key
    return h


def _qdrant_base():
    url = os.environ.get("QDRANT_URL", "").rstrip("/")
    if not url:
        raise RuntimeError("QDRANT_URL environment variable is not set.")
    return url


def _qdrant_collection():
    return os.environ.get("QDRANT_COLLECTION", "legal_clauses_v1").strip()


def _fetch_library(timeout=60.0):
    """Scroll all payloads from Qdrant (pagination)."""
    base = _qdrant_base()
    collection = _qdrant_collection()
    headers = _qdrant_headers()
    payloads = []
    next_page_offset = None
    while True:
        body = {"limit": 250, "with_payload": True, "with_vector": False}
        if next_page_offset is not None:
            body["offset"] = next_page_offset
        resp = requests.post(
            f"{base}/collections/{collection}/points/scroll",
            json=body,
            headers=headers,
            timeout=timeout,
        )
        resp.raise_for_status()
        data = resp.json().get("result", {})
        for point in data.get("points", []):
            p = dict(point.get("payload") or {})
            p["_point_id"] = point.get("id")
            payloads.append(p)
        next_page_offset = data.get("next_page_offset")
        if next_page_offset is None:
            break
    return payloads


def get_collection_stats():
    """Fetch live collection statistics and number of embeddings from Qdrant."""
    base = _qdrant_base()
    collection = _qdrant_collection()
    headers = _qdrant_headers()
    try:
        resp = requests.get(
            f"{base}/collections/{collection}",
            headers=headers,
            timeout=10.0,
        )
        resp.raise_for_status()
        data = resp.json().get("result", {})
        points_count = data.get("points_count", 0)
        status = data.get("status", "unknown")
        vectors_count = data.get("vectors_count") or points_count
        return {
            "status": "online",
            "collection": collection,
            "points_count": points_count,
            "vectors_count": vectors_count,
            "cluster_status": status,
        }
    except Exception as exc:
        logger.warning("Failed to get Qdrant collection stats: %s", exc)
        return {
            "status": "error",
            "collection": collection,
            "points_count": 0,
            "error": str(exc),
        }


# ---------------------------------------------------------------------------
# Embed
# ---------------------------------------------------------------------------
def _embed(text, timeout=None):
    if timeout is None:
        timeout = float(os.environ.get("EMBEDDING_API_TIMEOUT_SECONDS", "10"))
    t0 = time.perf_counter()
    resp = requests.post(
        EMBEDDING_URL,
        json={"texts": [text]},
        headers={"Accept": "*/*"},
        timeout=(min(5.0, timeout), timeout),
    )
    resp.raise_for_status()
    data = resp.json()
    vectors = data.get("embeddings")
    if vectors is None and isinstance(data.get("data"), list):
        vectors = [item.get("embedding") for item in data["data"]]
    if not vectors or not isinstance(vectors[0], list):
        raise RuntimeError("Embedding API returned an unexpected response.")
    return vectors[0], int((time.perf_counter() - t0) * 1000)


# ---------------------------------------------------------------------------
# RRF blend
# ---------------------------------------------------------------------------
def _rrf_blend(dense_hits, library, bm25_scores, top_n):
    import numpy as np

    dense_rank = {}
    dense_score_map = {}
    for rank, hit in enumerate(dense_hits, start=1):
        pid = (hit.get("payload") or {}).get("vector_id") or str(hit.get("id"))
        dense_rank[pid] = rank
        dense_score_map[pid] = float(hit.get("score", 0.0))

    order = np.argsort(-bm25_scores)[: top_n * 3]
    bm25_rank = {}
    bm25_raw = {}
    for rank, idx in enumerate(order, start=1):
        p = library[idx]
        pid = p.get("vector_id") or str(p.get("_point_id", idx))
        bm25_rank[pid] = rank
        bm25_raw[pid] = float(bm25_scores[idx])

    payloads_by_id = {}
    for hit in dense_hits:
        p = hit.get("payload") or {}
        pid = p.get("vector_id") or str(hit.get("id"))
        payloads_by_id[pid] = p
    for idx in order:
        p = library[idx]
        pid = p.get("vector_id") or str(p.get("_point_id", idx))
        if pid not in payloads_by_id:
            payloads_by_id[pid] = p

    blended = []
    for vid in set(dense_rank) | set(bm25_rank):
        in_dense = vid in dense_rank
        in_bm25 = vid in bm25_rank
        rrf = (
            (1.0 / (RRF_K + dense_rank[vid]) if in_dense else 0.0)
            + (1.0 / (RRF_K + bm25_rank[vid]) if in_bm25 else 0.0)
        )
        found_by = "both" if in_dense and in_bm25 else ("meaning" if in_dense else "keywords")
        blended.append({
            "vector_id": vid,
            "rrf_score": rrf,
            "dense_score": dense_score_map.get(vid, 0.0),
            "dense_rank": dense_rank.get(vid),
            "bm25_rank": bm25_rank.get(vid),
            "bm25_score": bm25_raw.get(vid, 0.0),
            "found_by": found_by,
            "payload": payloads_by_id.get(vid, {}),
        })

    blended.sort(key=lambda x: -x["rrf_score"])
    return blended[:top_n]


# ---------------------------------------------------------------------------
# Taxonomy resolution (authoritative from Postgres)
# ---------------------------------------------------------------------------
_NON_CLAUSE_NAMES = frozenset({
    # Title Case (matches CanonicalType.name in Postgres)
    "Preamble", "Recitals", "Table of Contents", "Signature Block",
    "Schedule & Exhibit Identification", "Page Furniture",
    "Notes & References", "Template Placeholder", "Other Non-Clause Content",
    "Agreement Identification", "Party Identification",
    # Kebab-case (matches canonical_type values stored in Qdrant payloads)
    "preamble", "recitals", "table-of-contents", "signature-block",
    "schedule-and-exhibit-identification", "page-furniture",
    "notes-and-references", "template-placeholder", "other-non-clause-content",
    "agreement-identification", "party-identification",
})


def _resolve_canonical(name):
    try:
        from document_pipeline.models import CanonicalType
        ct = CanonicalType.objects.filter(name=name).order_by("-version").first()
        if ct:
            label = "Clause" if ct.applies_to == "clause" else "Non-clause"
            return {
                "label": label,
                "applies_to": ct.applies_to,
                "definition": ct.definition or "",
                "key": ct.key,
            }
    except Exception as exc:
        logger.warning("CanonicalType DB lookup failed: %s", exc)

    # Heuristic fallback
    applies_to = "non_clause" if name in _NON_CLAUSE_NAMES else "clause"
    return {
        "label": "Non-clause" if applies_to == "non_clause" else "Clause",
        "applies_to": applies_to,
        "definition": "",
        "key": "",
    }


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
def run_playground(text, top_n=TOP_N):
    """
    Run the full diagnostic pipeline for a single clause text.

    Returns
    -------
    dict with keys:
      prediction       - label, canonical_type, sub_type, confidence,
                         needs_review, blindspot_warning (Idea 1)
      retrieval_matrix - dense / bm25 / rrf raw scores (Idea 4)
      library_matches  - top-5 results with shared_keywords diff (Idea 2)
      performance      - per-step latency in ms (Idea 4)
    """
    timings = {}

    dense_vec = None
    dense_error = None
    dense_hits = []

    # Step 1: embed
    try:
        dense_vec, timings["embed_ms"] = _embed(text)
    except Exception as exc:
        dense_error = str(exc)
        logger.warning("Dense embedding failed (%s), will fallback to BM25 keyword retrieval", exc)
        timings["embed_ms"] = 0

    # Step 2: dense search
    if dense_vec is not None:
        t0 = time.perf_counter()
        try:
            dense_hits = _dense_search(dense_vec, top_n * 2, timeout=EMBEDDING_TIMEOUT)
        except Exception as exc:
            dense_error = str(exc)
            logger.warning("Qdrant dense search failed: %s", exc)
            dense_hits = []
        timings["dense_search_ms"] = int((time.perf_counter() - t0) * 1000)
    else:
        timings["dense_search_ms"] = 0

    # Step 3: BM25
    t0 = time.perf_counter()
    library = []
    bm25_scores = None
    try:
        library = _fetch_library(timeout=EMBEDDING_TIMEOUT)
        lib_hash = hashlib.md5(
            f"{len(library)}:{(library[0].get('vector_id', '') if library else '')}".encode()
        ).hexdigest()
        idx_obj = _BM25Index.get(library, lib_hash)
        bm25_scores = idx_obj.bm25.get_scores(_tokenize(text))
    except Exception as exc:
        logger.warning("BM25 step failed: %s", exc)
        library = []
        bm25_scores = None
    timings["bm25_ms"] = int((time.perf_counter() - t0) * 1000)

    # Step 4: RRF blend / candidate construction
    t0 = time.perf_counter()
    if dense_hits and library and bm25_scores is not None:
        blended = _rrf_blend(dense_hits, library, bm25_scores, top_n)
        decided_by = "Hybrid Retrieval (Dense + BM25) + RRF"
    elif library and bm25_scores is not None:
        import numpy as np
        top_indices = np.argsort(bm25_scores)[::-1][:top_n]
        max_bm25 = float(np.max(bm25_scores)) if len(bm25_scores) > 0 and np.max(bm25_scores) > 0 else 1.0
        input_tokens_for_score = set(_tokenize(text))
        blended = []
        for rank, idx in enumerate(top_indices, start=1):
            lib_entry = library[idx]
            match_tokens = set(_tokenize(lib_entry.get("text", "")))
            # Keyword overlap confidence: Jaccard of meaningful tokens (len>3)
            meaningful_input = {w for w in input_tokens_for_score if len(w) > 3}
            meaningful_match = {w for w in match_tokens if len(w) > 3}
            if meaningful_input and meaningful_match:
                overlap = meaningful_input & meaningful_match
                # Jaccard similarity between input and match meaningful tokens
                jaccard = len(overlap) / len(meaningful_input | meaningful_match)
                # Normalize: a Jaccard of 0.5+ is good for BM25; cap at 0.65 since
                # BM25 has no semantic understanding, so we deliberately keep this
                # ceiling below the dense model's range to signal retrieval quality.
                bm25_conf = min(0.65, round(jaccard * 1.5, 4))
            else:
                bm25_conf = 0.0
            blended.append({
                "vector_id": lib_entry.get("vector_id") or str(lib_entry.get("_point_id")),
                "rrf_score": round(float(bm25_scores[idx]) / max_bm25, 4),
                # dense_score in BM25-only mode is NOT a cosine similarity.
                # We store the honest bm25_conf here so taxonomy can read it.
                "dense_score": bm25_conf,
                "dense_rank": None,
                "bm25_rank": rank,
                "bm25_score": float(bm25_scores[idx]),
                "found_by": "keywords",
                "payload": lib_entry,
            })
        decided_by = "BM25 Keyword Retrieval (Dense embedding server offline)"
    elif dense_hits:
        blended = [
            {
                "vector_id": (hit.get("payload") or {}).get("vector_id") or str(hit.get("id")),
                "rrf_score": 1.0 / (RRF_K + rank),
                "dense_score": float(hit.get("score", 0.0)),
                "dense_rank": rank,
                "bm25_rank": None,
                "bm25_score": 0.0,
                "found_by": "meaning",
                "payload": hit.get("payload") or {},
            }
            for rank, hit in enumerate(dense_hits[:top_n], start=1)
        ]
        decided_by = "Dense Vector Search (BM25 index unavailable)"
    else:
        blended = []
        decided_by = "No matches found"
    timings["rrf_ms"] = int((time.perf_counter() - t0) * 1000)


    # Step 5: taxonomy resolution
    t0 = time.perf_counter()
    top = blended[0] if blended else None
    is_bm25_only = dense_vec is None  # EC2 was unreachable
    if top:
        p = top["payload"]
        raw_canonical = p.get("canonical_type", "")
        raw_sub_type = p.get("sub_type") or None
        if is_bm25_only:
            confidence = float(top["dense_score"])
        else:
            confidence = float(top["dense_score"])

        # The `label` field is stored in the Qdrant payload at ingestion time
        # and is authoritative ground-truth ("Clause" / "Non-clause").
        # _resolve_canonical DB lookup is unreliable here because:
        #   a) canonical_type names in Qdrant use kebab-case ("recitals"),
        #      whereas CanonicalType.name uses different conventions.
        #   b) applies_to is None in payloads (not populated during ingestion).
        # So we read label directly from the payload and use _resolve_canonical
        # only for supplementary metadata (definition, key, applies_to).
        stored_label = p.get("label", "")  # "Clause" or "Non-clause" from Qdrant
        resolved = _resolve_canonical(raw_canonical)
        if stored_label in ("Clause", "Non-clause"):
            # Override the (potentially wrong) heuristic with the stored truth.
            resolved["label"] = stored_label
            resolved["applies_to"] = "clause" if stored_label == "Clause" else "non_clause"
    else:
        raw_canonical, raw_sub_type, confidence = "Unknown", None, 0.0
        resolved = {"label": "Non-clause", "applies_to": "non_clause", "definition": "", "key": ""}
    timings["taxonomy_ms"] = int((time.perf_counter() - t0) * 1000)
    timings["total_ms"] = sum(timings.values())

    # Store retrieval mode so the UI can label the score correctly.
    retrieval_mode = "bm25_only" if is_bm25_only else "hybrid"

    # Idea 1 - Vector Blindspot
    needs_review = confidence < CONFIDENCE_FLOOR
    blindspot = None
    if needs_review:
        blindspot = {
            "detected": True,
            "score": round(confidence, 4),
            "message": (
                f"Vector Blindspot detected (score {confidence:.2f}). "
                "The library has weak coverage for this clause formulation. "
                "Ingest more contracts with this provision to improve recall."
            ),
        }

    # Idea 2 - Keyword Diff
    input_tokens = set(_tokenize(text))
    library_matches = []
    for i, candidate in enumerate(blended[:5]):
        p = candidate["payload"]
        match_text = p.get("text", "")
        shared = sorted(
            {w for w in input_tokens & set(_tokenize(match_text)) if len(w) > 3},
            key=lambda w: -len(w),
        )[:10]
        library_matches.append({
            "rank": i + 1,
            "vector_id": candidate["vector_id"],
            "text": match_text,
            "canonical_type": p.get("canonical_type", ""),
            "sub_type": p.get("sub_type") or None,
            "label": p.get("label", ""),
            "document_name": p.get("document_name", ""),
            "similarity_score": round(candidate["dense_score"], 4),
            "rrf_score": round(candidate["rrf_score"], 6),
            "found_by": candidate["found_by"],
            "shared_keywords": shared,
        })

    return {
        "prediction": {
            "label": resolved["label"],
            "canonical_type": raw_canonical,
            "sub_type": raw_sub_type,
            "confidence": round(confidence, 4),
            "needs_review": needs_review,
            "decided_by": decided_by,
            "reason": (
                (
                    "Top library match: \"" + library_matches[0]["text"][:120] + "\"" +
                    " from " + library_matches[0]["document_name"]
                )
                if library_matches else "No library matches found."
            ),
            "blindspot_warning": blindspot,
        },
        "dense_service": {
            "status": "offline" if dense_error else "online",
            "error": dense_error,
            "url": EMBEDDING_URL,
        },
        "retrieval_mode": retrieval_mode,
        "collection_stats": {
            "collection": _qdrant_collection(),
            "points_count": len(library),
            "status": "online" if library else "offline",
        },
        "retrieval_matrix": {
            "dense_rank": top["dense_rank"] if top else None,
            "dense_score": round(top["dense_score"], 4) if top else 0.0,
            "bm25_rank": top.get("bm25_rank") if top else None,
            "bm25_score": round(top.get("bm25_score", 0.0), 4) if top else 0.0,
            "rrf_score": round(top["rrf_score"], 6) if top else 0.0,
            "found_by": top["found_by"] if top else "none",
            "library_size": len(library),
        },
        "library_matches": library_matches,
        "performance": {
            "embed_ms": timings.get("embed_ms", 0),
            "dense_search_ms": timings.get("dense_search_ms", 0),
            "bm25_ms": timings.get("bm25_ms", 0),
            "rrf_ms": timings.get("rrf_ms", 0),
            "taxonomy_ms": timings.get("taxonomy_ms", 0),
            "total_ms": timings.get("total_ms", 0),
        },
    }
