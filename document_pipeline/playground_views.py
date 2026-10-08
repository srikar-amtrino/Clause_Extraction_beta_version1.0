import json
import logging

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from core.auth_helpers import require_auth
from document_pipeline.services.playground_service import get_collection_stats, run_playground

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

