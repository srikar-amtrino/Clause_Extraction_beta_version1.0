"""Helper for creating DocumentActivityLog entries.

Import and call ``log_activity`` from any task or view that mutates a
document. Failures are logged but never re-raised -- a missing audit
entry must never abort the primary operation.
"""
import logging

logger = logging.getLogger(__name__)


def log_activity(
    document_id,
    phase,
    action,
    *,
    summary='',
    actor_user=None,
    actor_system='',
    metadata=None,
):
    """Create one DocumentActivityLog row.

    Parameters
    ----------
    document_id : UUID or str
        The Document primary key.
    phase : str
        One of DocumentActivityLog.PHASE_CHOICES keys.
    action : str
        One of the ACT_* constants or a free-form verb string.
    summary : str
        Human-readable sentence shown in the activity timeline.
    actor_user : User instance or None
        Populated for user-driven events; None for automated phases.
    actor_system : str
        Label such as ``"Drive Sync"`` or ``"LLM Classifier"`` for automated events.
    metadata : dict or None
        Structured details (counts, diffs, paragraph ids, etc.).
    """
    try:
        from document_pipeline.models import DocumentActivityLog
        DocumentActivityLog.objects.create(
            document_id=document_id,
            phase=phase,
            action=action,
            summary=summary,
            actor_user=actor_user,
            actor_system=actor_system,
            metadata=metadata or {},
        )
    except Exception:
        logger.exception(
            'Failed to create activity log for document %s action %s',
            document_id, action,
        )
