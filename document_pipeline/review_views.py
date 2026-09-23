"""Review workspace API views.

All endpoints require a valid JWT token (via core.auth_helpers.require_auth).

Lock lifecycle
--------------
POST  /api/documents/{id}/workspace/lock/            -- acquire
POST  /api/documents/{id}/workspace/lock/heartbeat/  -- renew TTL
POST  /api/documents/{id}/workspace/lock/release/    -- release

Paragraph editing
-----------------
POST  /api/documents/{id}/workspace/paragraphs/{para_id}/  -- update one
POST  /api/documents/{id}/workspace/bulk-update/            -- update many

Draft management (24h auto-discard)
------------------------------------
POST   /api/documents/{id}/workspace/draft/    -- autosave / overwrite draft
DELETE /api/documents/{id}/workspace/draft/    -- discard draft

Commit & publish
----------------
POST /api/documents/{id}/workspace/save/     -- commit edits to Postgres
POST /api/documents/{id}/workspace/publish/  -- validate then queue embed

Activity & notes
----------------
GET  /api/documents/{id}/activity/       -- 5-phase timeline
GET  /api/documents/{id}/contributors/   -- per-user contribution counts
GET  /api/activity/calendar/             -- daily event density
GET  /api/documents/{id}/note/           -- read note
POST /api/documents/{id}/note/           -- write note

Document library with review_status filter
------------------------------------------
GET  /api/documents/stats/               -- status counts
GET  /api/documents/queue/               -- in-flight + review-ready
"""
import json
import logging

from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from core.auth_helpers import require_auth

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _json(data, status=200):
    return JsonResponse(data, status=status)


def _err(msg, status=400):
    return JsonResponse({'detail': msg}, status=status)


def _get_lock(document_id):
    """Return active WorkspaceLock or None."""
    from document_pipeline.models import WorkspaceLock
    try:
        lock = WorkspaceLock.objects.select_related('user').get(document_id=document_id)
        return lock if lock.is_active else None
    except WorkspaceLock.DoesNotExist:
        return None


def _check_editable(document_id, user):
    """Return (True, None) if user may write; (False, response) otherwise."""
    lock = _get_lock(document_id)
    if lock is None:
        return False, _err(
            'No active workspace lock. Acquire a lock before editing.', 403)
    if lock.user_id != user.id:
        return False, _err(
            'Document is locked by %s. Open in read-only mode.' % lock.user.username,
            423)
    return True, None


def _compute_progress(document_id):
    from document_pipeline.models import DocumentParagraphRecord
    qs = DocumentParagraphRecord.objects.filter(document_id=document_id)
    total = qs.count()
    reviewed = qs.filter(is_reviewed=True).count()
    return reviewed, total


def _blockers(document_id):
    """Return list of blocker strings that prevent publishing."""
    from document_pipeline.models import DocumentParagraphRecord
    qs = DocumentParagraphRecord.objects.filter(document_id=document_id)
    issues = []
    not_reviewed = qs.filter(is_reviewed=False).count()
    if not_reviewed:
        issues.append('%d paragraph(s) still to review' % not_reviewed)
    missing_type = qs.filter(label='Clause', canonical_type='').count()
    if missing_type:
        issues.append('%d paragraph(s) missing canonical type' % missing_type)
    empty_text = qs.filter(reviewed_text='').count()
    if empty_text:
        issues.append('%d paragraph(s) have empty text' % empty_text)
    return issues


# ---------------------------------------------------------------------------
# Workspace read  -- GET /api/documents/{id}/workspace/
# ---------------------------------------------------------------------------

@csrf_exempt
@require_auth
@require_http_methods(['GET'])
def workspace_detail(request, document_id):
    """Return full workspace data for one document."""
    from document_pipeline.models import (
        Document, DocumentParagraphRecord, ReviewDraft, WorkspaceLock
    )

    try:
        doc = Document.objects.get(pk=document_id)
    except Document.DoesNotExist:
        return _err('Document not found.', 404)

    user = request.user
    lock = _get_lock(document_id)
    is_locked_by_other = lock and lock.user_id != user.id
    is_read_only = is_locked_by_other

    paragraphs = list(
        DocumentParagraphRecord.objects
        .filter(document_id=document_id)
        .order_by('sequence_order')
        .values(
            'paragraph_id', 'breadcrumb', 'source_page', 'sequence_order',
            'original_text', 'reviewed_text', 'label', 'canonical_type',
            'sub_type', 'confidence', 'llm_issues',
            'is_reviewed', 'is_modified',
            'reviewed_by_id', 'last_edited_by_id', 'last_edited_at',
        )
    )
    reviewed_count, total = _compute_progress(document_id)

    # Active draft for THIS user.
    draft_info = None
    try:
        draft = ReviewDraft.objects.get(document_id=document_id, user=user)
        if not draft.is_expired:
            draft_info = {
                'exists': True,
                'seconds_remaining': draft.seconds_remaining,
                'updated_at': draft.updated_at.isoformat(),
            }
        else:
            draft.delete()
    except ReviewDraft.DoesNotExist:
        pass

    lock_info = None
    if lock:
        lock_info = {
            'locked_by': lock.user.username,
            'locked_by_id': lock.user_id,
            'locked_at': lock.locked_at.isoformat(),
            'expires_at': lock.expires_at.isoformat(),
            'is_yours': lock.user_id == user.id,
        }

    # Latest vector sync.
    from document_pipeline.models import VectorSyncRun
    last_sync = (
        VectorSyncRun.objects
        .filter(document_id=document_id, status=VectorSyncRun.SUCCEEDED)
        .order_by('-started_at')
        .first()
    )

    return _json({
        'document_id': str(document_id),
        'review_status': doc.review_status,
        'is_read_only': is_read_only,
        'lock': lock_info,
        'progress': {'reviewed': reviewed_count, 'total': total},
        'blockers': _blockers(document_id),
        'paragraphs': paragraphs,
        'draft': draft_info,
        'last_vector_sync': {
            'records': last_sync.records_embedded if last_sync else 0,
            'synced_at': last_sync.started_at.isoformat() if last_sync else None,
        },
    })


# ---------------------------------------------------------------------------
# Lock endpoints
# ---------------------------------------------------------------------------

@csrf_exempt
@require_auth
@require_http_methods(['POST'])
def lock_acquire(request, document_id):
    """Acquire the soft workspace lock."""
    from document_pipeline.models import Document, DocumentActivityLog, WorkspaceLock
    from document_pipeline.activity import log_activity

    try:
        doc = Document.objects.get(pk=document_id)
    except Document.DoesNotExist:
        return _err('Document not found.', 404)

    user = request.user
    existing = _get_lock(document_id)

    if existing and existing.user_id != user.id:
        return _json({
            'acquired': False,
            'is_read_only': True,
            'locked_by': existing.user.username,
            'locked_by_id': existing.user_id,
            'expires_at': existing.expires_at.isoformat(),
        })

    if existing and existing.user_id == user.id:
        existing.renew()
        lock = existing
    else:
        # Remove any stale (expired) lock first.
        WorkspaceLock.objects.filter(document_id=document_id).delete()
        lock = WorkspaceLock.objects.create(
            document_id=document_id, user=user)

    # Transition review status to in_review / reopened_in_review.
    if doc.review_status == 'needs_review':
        new_status = 'in_review'
    elif doc.review_status == 'published':
        new_status = 'reopened_in_review'
    else:
        new_status = doc.review_status

    Document.objects.filter(pk=document_id).update(
        review_status=new_status, current_reviewer=user)

    log_activity(
        document_id=document_id,
        phase=DocumentActivityLog.USER_INTERACTION,
        action=DocumentActivityLog.ACT_LOCK_ACQUIRED,
        summary='%s opened the workspace.' % user.username,
        actor_user=user,
    )

    return _json({
        'acquired': True,
        'is_read_only': False,
        'expires_at': lock.expires_at.isoformat(),
        'review_status': new_status,
    })


@csrf_exempt
@require_auth
@require_http_methods(['POST'])
def lock_heartbeat(request, document_id):
    """Extend the workspace lock TTL."""
    user = request.user
    lock = _get_lock(document_id)
    if not lock or lock.user_id != user.id:
        return _err('No active lock held by you.', 403)
    lock.renew()
    return _json({'expires_at': lock.expires_at.isoformat()})


@csrf_exempt
@require_auth
@require_http_methods(['POST'])
def lock_release(request, document_id):
    """Release the workspace lock."""
    from document_pipeline.models import Document, DocumentActivityLog, WorkspaceLock
    from document_pipeline.activity import log_activity

    user = request.user
    lock = _get_lock(document_id)
    if not lock or lock.user_id != user.id:
        return _err('No active lock held by you.', 403)

    lock.delete()
    Document.objects.filter(pk=document_id).update(current_reviewer=None)

    log_activity(
        document_id=document_id,
        phase=DocumentActivityLog.USER_INTERACTION,
        action=DocumentActivityLog.ACT_LOCK_RELEASED,
        summary='%s closed the workspace.' % user.username,
        actor_user=user,
    )
    return _json({'released': True})


# ---------------------------------------------------------------------------
# Paragraph update  -- single
# ---------------------------------------------------------------------------

@csrf_exempt
@require_auth
@require_http_methods(['POST'])
def paragraph_update(request, document_id, para_id):
    """Update a single paragraph record."""
    from document_pipeline.models import DocumentActivityLog, DocumentParagraphRecord
    from document_pipeline.activity import log_activity

    user = request.user
    ok, resp = _check_editable(document_id, user)
    if not ok:
        return resp

    try:
        record = DocumentParagraphRecord.objects.get(
            document_id=document_id, paragraph_id=para_id)
    except DocumentParagraphRecord.DoesNotExist:
        return _err('Paragraph not found.', 404)

    try:
        body = json.loads(request.body)
    except (ValueError, TypeError):
        return _err('Invalid JSON body.')

    changed_fields = ['updated_at']
    actions = []

    if 'reviewed_text' in body and body['reviewed_text'] != record.reviewed_text:
        record.reviewed_text = body['reviewed_text']
        record.is_modified = True
        record.last_edited_by = user
        record.last_edited_at = timezone.now()
        changed_fields += ['reviewed_text', 'is_modified', 'last_edited_by', 'last_edited_at']
        actions.append(DocumentActivityLog.ACT_PARA_EDITED)

    if 'canonical_type' in body and body['canonical_type'] != record.canonical_type:
        record.canonical_type = body['canonical_type']
        record.is_modified = True
        record.last_edited_by = user
        record.last_edited_at = timezone.now()
        changed_fields += ['canonical_type', 'is_modified', 'last_edited_by', 'last_edited_at']
        actions.append(DocumentActivityLog.ACT_TYPE_CHANGED)

    if 'sub_type' in body:
        record.sub_type = body['sub_type']
        changed_fields.append('sub_type')

    if 'label' in body:
        record.label = body['label']
        record.is_modified = True
        changed_fields += ['label', 'is_modified']

    if 'is_reviewed' in body:
        record.is_reviewed = bool(body['is_reviewed'])
        if record.is_reviewed:
            record.reviewed_by = user
            changed_fields += ['is_reviewed', 'reviewed_by']
        else:
            changed_fields.append('is_reviewed')
        actions.append(DocumentActivityLog.ACT_MARKED_REVIEWED)

    record.save(update_fields=list(set(changed_fields)))

    for action in actions:
        log_activity(
            document_id=document_id,
            phase=DocumentActivityLog.USER_INTERACTION,
            action=action,
            summary='%s %s on %s.' % (user.username, action.replace('_', ' '), para_id),
            actor_user=user,
            metadata={'paragraph_id': para_id},
        )

    return _json({'paragraph_id': para_id, 'updated': True})


# ---------------------------------------------------------------------------
# Bulk paragraph update
# ---------------------------------------------------------------------------

@csrf_exempt
@require_auth
@require_http_methods(['POST'])
def bulk_update(request, document_id):
    """Bulk-update (mark reviewed / set type) multiple paragraphs."""
    from document_pipeline.models import DocumentActivityLog, DocumentParagraphRecord
    from document_pipeline.activity import log_activity

    user = request.user
    ok, resp = _check_editable(document_id, user)
    if not ok:
        return resp

    try:
        body = json.loads(request.body)
    except (ValueError, TypeError):
        return _err('Invalid JSON body.')

    para_ids = body.get('paragraph_ids', [])
    if not para_ids:
        return _err('paragraph_ids is required and must be non-empty.')

    records = DocumentParagraphRecord.objects.filter(
        document_id=document_id, paragraph_id__in=para_ids)

    update_kwargs = {}
    if 'is_reviewed' in body:
        update_kwargs['is_reviewed'] = bool(body['is_reviewed'])
        if update_kwargs['is_reviewed']:
            update_kwargs['reviewed_by'] = user
    if 'canonical_type' in body:
        update_kwargs['canonical_type'] = body['canonical_type']
        update_kwargs['is_modified'] = True
    if 'label' in body:
        update_kwargs['label'] = body['label']
        update_kwargs['is_modified'] = True

    count = records.update(**update_kwargs)

    log_activity(
        document_id=document_id,
        phase=DocumentActivityLog.USER_INTERACTION,
        action=DocumentActivityLog.ACT_MARKED_REVIEWED,
        summary='%s bulk-updated %d paragraphs.' % (user.username, count),
        actor_user=user,
        metadata={'paragraph_ids': para_ids, 'fields': list(update_kwargs.keys())},
    )

    return _json({'updated': count})


# ---------------------------------------------------------------------------
# Draft  -- autosave / discard
# ---------------------------------------------------------------------------

@csrf_exempt
@require_auth
@require_http_methods(['POST'])
def draft_save(request, document_id):
    """Autosave uncommitted draft state (creates or overwrites)."""
    from document_pipeline.models import Document, DocumentActivityLog, ReviewDraft
    from document_pipeline.activity import log_activity

    user = request.user
    ok, resp = _check_editable(document_id, user)
    if not ok:
        return resp

    try:
        body = json.loads(request.body)
    except (ValueError, TypeError):
        return _err('Invalid JSON body.')

    draft, created = ReviewDraft.objects.update_or_create(
        document_id=document_id,
        user=user,
        defaults={'draft_payload': body.get('payload', [])},
    )

    # Set review_status to 'draft' if not already.
    doc = Document.objects.get(pk=document_id)
    if doc.review_status not in ('draft',):
        Document.objects.filter(pk=document_id).update(review_status='draft')

    log_activity(
        document_id=document_id,
        phase=DocumentActivityLog.USER_INTERACTION,
        action=DocumentActivityLog.ACT_DRAFT_SAVED,
        summary='%s saved an autosave draft.' % user.username,
        actor_user=user,
        metadata={'expires_at': draft.expires_at.isoformat()},
    )

    return _json({
        'draft_id': str(draft.id),
        'expires_at': draft.expires_at.isoformat(),
        'seconds_remaining': draft.seconds_remaining,
        'created': created,
    })


@csrf_exempt
@require_auth
@require_http_methods(['DELETE'])
def draft_discard(request, document_id):
    """Discard the current user draft and revert to saved state."""
    from document_pipeline.models import Document, DocumentActivityLog, ReviewDraft
    from document_pipeline.activity import log_activity

    user = request.user
    try:
        draft = ReviewDraft.objects.get(document_id=document_id, user=user)
        draft.delete()
    except ReviewDraft.DoesNotExist:
        return _err('No draft to discard.', 404)

    # Revert review_status from draft.
    doc = Document.objects.get(pk=document_id)
    if doc.review_status == 'draft':
        revert = 'in_review'
        Document.objects.filter(pk=document_id).update(review_status=revert)

    log_activity(
        document_id=document_id,
        phase=DocumentActivityLog.USER_INTERACTION,
        action=DocumentActivityLog.ACT_DRAFT_DISCARDED,
        summary='%s discarded their draft.' % user.username,
        actor_user=user,
    )
    return _json({'discarded': True})


# ---------------------------------------------------------------------------
# Save (commit to Postgres)
# ---------------------------------------------------------------------------

@csrf_exempt
@require_auth
@require_http_methods(['POST'])
def workspace_save(request, document_id):
    """Commit edits: clear draft and transition status to reviewed."""
    from document_pipeline.models import (
        Document, DocumentActivityLog, DocumentParagraphRecord, ReviewDraft
    )
    from document_pipeline.activity import log_activity

    user = request.user
    ok, resp = _check_editable(document_id, user)
    if not ok:
        return resp

    # Delete draft if present.
    ReviewDraft.objects.filter(document_id=document_id, user=user).delete()

    reviewed, total = _compute_progress(document_id)

    doc = Document.objects.get(pk=document_id)
    if reviewed == total and total > 0:
        new_status = (
            'reopened_reviewed'
            if doc.review_status in ('reopened_in_review',)
            else 'reviewed'
        )
    else:
        new_status = (
            'reopened_in_review'
            if doc.review_status in ('reopened_in_review', 'reopened_reviewed')
            else 'in_review'
        )

    Document.objects.filter(pk=document_id).update(review_status=new_status)

    log_activity(
        document_id=document_id,
        phase=DocumentActivityLog.USER_INTERACTION,
        action=DocumentActivityLog.ACT_SAVED,
        summary='%s saved review progress (%d/%d reviewed).' % (
            user.username, reviewed, total),
        actor_user=user,
        metadata={'reviewed': reviewed, 'total': total},
    )

    return _json({
        'saved': True,
        'review_status': new_status,
        'progress': {'reviewed': reviewed, 'total': total},
    })


# ---------------------------------------------------------------------------
# Publish (validate + queue Celery embed task)
# ---------------------------------------------------------------------------

@csrf_exempt
@require_auth
@require_http_methods(['POST'])
def workspace_publish(request, document_id):
    """Validate blockers and queue the embed + vector DB sync task."""
    from document_pipeline.tasks.publish import publish_document_task

    user = request.user
    ok, resp = _check_editable(document_id, user)
    if not ok:
        return resp

    blockers = _blockers(document_id)
    if blockers:
        return _json({'can_publish': False, 'blockers': blockers}, status=422)

    task = publish_document_task.delay(str(document_id), str(user.id))
    return _json({
        'queued': True,
        'task_id': task.id,
        'message': 'Publishing queued. The document will be updated shortly.',
    })


# ---------------------------------------------------------------------------
# Activity log -- 5-phase timeline
# ---------------------------------------------------------------------------

@require_auth
@require_http_methods(['GET'])
def document_activity(request, document_id):
    """Return the 5-phase activity timeline for one document."""
    from document_pipeline.models import Document, DocumentActivityLog

    try:
        Document.objects.get(pk=document_id)
    except Document.DoesNotExist:
        return _err('Document not found.', 404)

    phase_order = [
        DocumentActivityLog.DATA_INGESTION,
        DocumentActivityLog.DATA_STAGING,
        DocumentActivityLog.DATA_PARSING,
        DocumentActivityLog.DATA_CLASSIFICATION,
        DocumentActivityLog.USER_INTERACTION,
    ]
    logs = (
        DocumentActivityLog.objects
        .filter(document_id=document_id)
        .select_related('actor_user')
        .order_by('created_at')
    )

    phases = {p: [] for p in phase_order}
    for entry in logs:
        phases[entry.phase].append({
            'id': str(entry.id),
            'action': entry.action,
            'summary': entry.summary,
            'actor': (entry.actor_user.username if entry.actor_user
                      else entry.actor_system),
            'metadata': entry.metadata,
            'created_at': entry.created_at.isoformat(),
        })

    return _json({
        'document_id': str(document_id),
        'phases': [
            {'phase': p, 'label': dict(DocumentActivityLog.PHASE_CHOICES)[p],
             'events': phases[p]}
            for p in phase_order
        ],
    })


# ---------------------------------------------------------------------------
# Contributors
# ---------------------------------------------------------------------------

@require_auth
@require_http_methods(['GET'])
def document_contributors(request, document_id):
    """Per-user contribution summary for one document."""
    from django.db.models import Count
    from document_pipeline.models import Document, DocumentActivityLog

    try:
        Document.objects.get(pk=document_id)
    except Document.DoesNotExist:
        return _err('Document not found.', 404)

    rows = (
        DocumentActivityLog.objects
        .filter(
            document_id=document_id,
            phase=DocumentActivityLog.USER_INTERACTION,
            actor_user__isnull=False,
        )
        .values('actor_user__id', 'actor_user__username')
        .annotate(event_count=Count('id'))
        .order_by('-event_count')
    )

    return _json({
        'document_id': str(document_id),
        'contributors': [
            {
                'user_id': r['actor_user__id'],
                'username': r['actor_user__username'],
                'event_count': r['event_count'],
            }
            for r in rows
        ],
    })


# ---------------------------------------------------------------------------
# Activity calendar
# ---------------------------------------------------------------------------

@require_auth
@require_http_methods(['GET'])
def activity_calendar(request):
    """Daily event density across all documents (for the calendar view)."""
    from django.db.models import Count
    from django.db.models.functions import TruncDate
    from document_pipeline.models import DocumentActivityLog

    rows = (
        DocumentActivityLog.objects
        .annotate(date=TruncDate('created_at'))
        .values('date')
        .annotate(count=Count('id'))
        .order_by('date')
    )
    return _json({
        'days': [{'date': r['date'].isoformat(), 'count': r['count']} for r in rows]
    })


# ---------------------------------------------------------------------------
# Document note
# ---------------------------------------------------------------------------

@csrf_exempt
@require_auth
@require_http_methods(['GET', 'POST'])
def document_note(request, document_id):
    """Get or replace the collaborative document note."""
    from document_pipeline.models import Document, DocumentNote

    try:
        Document.objects.get(pk=document_id)
    except Document.DoesNotExist:
        return _err('Document not found.', 404)

    if request.method == 'GET':
        try:
            note = DocumentNote.objects.get(document_id=document_id)
            return _json({'text': note.text, 'updated_at': note.updated_at.isoformat()})
        except DocumentNote.DoesNotExist:
            return _json({'text': '', 'updated_at': None})

    # POST
    try:
        body = json.loads(request.body)
    except (ValueError, TypeError):
        return _err('Invalid JSON body.')

    note, _ = DocumentNote.objects.update_or_create(
        document_id=document_id,
        defaults={'text': body.get('text', ''), 'author': request.user},
    )
    return _json({'text': note.text, 'updated_at': note.updated_at.isoformat()})


# ---------------------------------------------------------------------------
# Document stats and queue
# ---------------------------------------------------------------------------

@require_auth
@require_http_methods(['GET'])
def document_stats(request):
    """Status counts across all documents."""
    from django.db.models import Count
    from document_pipeline.models import Document

    rows = (
        Document.objects
        .values('review_status')
        .annotate(count=Count('id'))
    )
    return _json({'counts': {r['review_status']: r['count'] for r in rows}})


@require_auth
@require_http_methods(['GET'])
def document_queue(request):
    """In-flight pipeline documents + documents awaiting review."""
    from document_pipeline.models import Document, PipelineStageLog

    # In-flight: docs whose latest pipeline stage is not yet complete.
    in_flight = list(
        Document.objects
        .filter(review_status='pending_classification')
        .order_by('-created_at')[:50]
        .values('id', 'name', 'review_status', 'created_at')
    )

    # Review-ready: classified, awaiting first reviewer.
    needs_review = list(
        Document.objects
        .filter(review_status='needs_review')
        .order_by('-created_at')[:50]
        .select_related('current_reviewer')
        .values(
            'id', 'name', 'review_status',
            'current_reviewer__username', 'created_at',
        )
    )

    return _json({
        'in_flight': in_flight,
        'needs_review': needs_review,
    })
