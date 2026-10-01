import json
import logging

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from core.auth_helpers import require_auth

logger = logging.getLogger(__name__)


def _err(msg, status=400):
    return JsonResponse({"detail": msg}, status=status)


@csrf_exempt
@require_http_methods(["POST"])
def playground_analyze(request):
    """Run the hybrid retrieval pipeline for an ad-hoc clause text.

    POST /api/playground/
    {
        "text":  "<clause text>",
        "top_n": 10          # optional, 1-20
    }
    Requires a valid JWT token identical to the review workspace.
    """
    user, err = require_auth(request)
    if err:
        return err

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

    try:
        from document_pipeline.services.playground_service import run_playground
        result = run_playground(text=text, top_n=top_n)
    except RuntimeError as exc:
        logger.warning("Playground pipeline error: %s", exc)
        return JsonResponse({"detail": str(exc)}, status=502)
    except Exception as exc:
        logger.exception("Unexpected playground error: %s", exc)
        return JsonResponse({"detail": "Internal server error."}, status=500)

    return JsonResponse(result, status=200)
