"""Service for finalizing document classification.

Handles post-classification checks, status updates, and frontend notifications.
"""
import logging
from django.utils import timezone

logger = logging.getLogger(__name__)


def check_low_confidence_chunks(document_id) -> bool:
    """Check if any classification in the latest run has low confidence requiring judge."""
    from document_pipeline.models import Classification, ClassificationRun

    run = ClassificationRun.objects.filter(document_id=document_id, is_current=True).first()
    if not run:
        return False

    return Classification.objects.filter(run=run, confidence__lt=0.7).exists()


def update_document_status(document_id, status: str = "NEEDS_REVIEW"):
    """Update document review_status."""
    from document_pipeline.models import Document

    normalized_status = status.lower()
    Document.objects.filter(pk=document_id).update(
        review_status=normalized_status,
        updated_at=timezone.now(),
    )


def notify_frontend_via_websocket(document_id, event: str = "DOCUMENT_CLASSIFIED"):
    """Broadcast websocket update to frontend subscribers."""
    logger.info("notify_frontend_via_websocket: doc=%s event=%s", document_id, event)
    # Channel layers hook if channels is installed/configured
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer
        channel_layer = get_channel_layer()
        if channel_layer:
            async_to_sync(channel_layer.group_send)(
                f"document_{document_id}",
                {
                    "type": "document_status_update",
                    "event": event,
                    "document_id": str(document_id),
                }
            )
    except Exception as exc:
        logger.debug("Websocket notification skipped: %s", exc)
