import json
import logging

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from core.auth_helpers import require_auth
from document_pipeline.services.playground_service import (
    generate_clause_suggestions,
    get_collection_stats,
    run_playground,
)

logger = logging.getLogger(__name__)


def _err(msg, status=400):
    return JsonResponse({"detail": msg}, status=status)


@csrf_exempt
@require_http_methods(["GET"])
@require_auth
def playground_stats(request):
    """Return live vector DB status, collection name, and number of embeddings.

    GET /api/playground/stats/
    Requires a valid JWT token.
    """
    try:
        stats = get_collection_stats()
        return JsonResponse(stats, status=200)
    except Exception as exc:
        logger.exception("Unexpected error fetching playground stats: %s", exc)
        return JsonResponse({"detail": "Internal server error."}, status=500)


@csrf_exempt
@require_http_methods(["POST"])
@require_auth
def playground_analyze(request):
    """Run the hybrid retrieval pipeline for an ad-hoc clause text.

    POST /api/playground/
    {
        "text":  "<clause text>",
        "top_n": 10          # optional, 1-20
    }
    Requires a valid JWT token.
    """
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return _err("Request body must be valid JSON.")

    text = (body.get("text") or "").strip()
    if not text:
        return _err("text is required and must be a non-empty string.")
    if len(text) > 8000:
        return _err("text must be 8,000 characters or fewer.")

    raw_top_n = body.get("top_n", 10)
    try:
        top_n = max(1, min(20, int(raw_top_n)))
    except (TypeError, ValueError):
        return _err("top_n must be an integer between 1 and 20.")

    agreement_type = (body.get("agreement_type") or "").strip() or None
    sectorial_category = (body.get("sectorial_category") or "").strip() or None

    try:
        result = run_playground(
            text=text,
            top_n=top_n,
            agreement_type=agreement_type,
            sectorial_category=sectorial_category,
        )
    except RuntimeError as exc:
        logger.warning("Playground pipeline error: %s", exc)
        return JsonResponse({"detail": str(exc)}, status=502)
    except Exception as exc:
        logger.exception("Unexpected playground error: %s", exc)
        return JsonResponse({"detail": "Internal server error."}, status=500)

    return JsonResponse(result, status=200)


@csrf_exempt
@require_http_methods(["POST"])
@require_auth
def playground_suggest(request):
    """Generate on-demand AI review, Vector DB hygiene audit, and ingestion suggestions via Claude Sonnet.

    POST /api/playground/suggest/
    """
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return _err("Request body must be valid JSON.")

    text = (body.get("text") or "").strip()
    if not text:
        return _err("text is required and must be a non-empty string.")

    canonical_type = (body.get("canonical_type") or "").strip()
    top_similarity = float(body.get("top_similarity") or 0.0)
    count_in_library = int(body.get("count_in_library") or 0)
    document_spread = int(body.get("document_spread") or 0)
    total_documents = int(body.get("total_documents") or 0)
    active_sector = (body.get("active_sector") or "All").strip()
    active_agreement = (body.get("active_agreement") or "All").strip()
    document_names = body.get("document_names") or []

    try:
        suggestion = generate_clause_suggestions(
            text=text,
            canonical_type=canonical_type,
            top_similarity=top_similarity,
            count_in_library=count_in_library,
            document_spread=document_spread,
            total_documents=total_documents,
            active_sector=active_sector,
            active_agreement=active_agreement,
            document_names=document_names,
        )
        return JsonResponse(suggestion, status=200)
    except Exception as exc:
        logger.exception("Failed to generate playground suggestions: %s", exc)
        return JsonResponse({"detail": f"AI suggestion error: {str(exc)}"}, status=502)

