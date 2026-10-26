"""Review workspace API views.

All endpoints require a valid JWT token (via core.auth_helpers.require_auth).

Lock lifecycle
--------------
POST  /api/documents/{id}/workspace/lock/            -- acquire
POST  /api/documents/{id}/workspace/lock/heartbeat/  -- renew TTL
POST  /api/documents/{id}/workspace/lock/release/    -- release

Clause edits go through POST /api/documents/{id}/classification/save/
(document_views), which writes the classification row and this workspace's
paragraph record together.

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
GET  /api/documents/queue/               -- in-flight + review-ready + unprocessable
"""
import json
import logging
import uuid

from django.db import transaction
from django.http import JsonResponse
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
    """Return active WorkspaceLock or None.

    If a lock row exists but its TTL has expired, delete it and clear the
    denormalised ``current_reviewer`` on the Document so the next caller
    sees a clean state without waiting for the background cleaner task.
    """
    from document_pipeline.models import Document, WorkspaceLock
    try:
        lock = WorkspaceLock.objects.select_related('user').get(document_id=document_id)
    except WorkspaceLock.DoesNotExist:
        return None
    if lock.is_active:
        return lock
    # Expired — remove ghost lock atomically.
    lock.delete()
    Document.objects.filter(pk=document_id).update(current_reviewer=None)
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


def _status_when_workspace_opened(status):
    if status == 'needs_review':
        return 'in_review'
    if status == 'published':
        return 'reopened_in_review'
    return status


def _live_records(document_id):
    """The document's paragraph records, less the items a reviewer deleted."""
    from document_pipeline.models import Document, DocumentParagraphRecord
    from document_pipeline.services.review_service import deleted_paragraph_ids

    qs = DocumentParagraphRecord.objects.filter(document_id=document_id)
    document = Document.objects.filter(pk=document_id).first()
    deleted = deleted_paragraph_ids(document) if document else set()
    return qs.exclude(paragraph_id__in=deleted) if deleted else qs


def _compute_progress(document_id):
    qs = _live_records(document_id)
    total = qs.count()
    reviewed = qs.filter(is_reviewed=True).count()
    return reviewed, total


def _publish_readiness(document_id):
    """review_service.publish_readiness for a document id."""
    from document_pipeline.models import Document
    from document_pipeline.services.review_service import publish_readiness

    return publish_readiness(Document.objects.filter(pk=document_id).first())


def _blockers(document_id):
    """Return list of blocker strings that prevent publishing."""
    return _publish_readiness(document_id)['blockers']


# ---------------------------------------------------------------------------
# Workspace read  -- GET /api/documents/{id}/workspace/
# ---------------------------------------------------------------------------

@csrf_exempt
@require_auth
@require_http_methods(['GET'])
def workspace_detail(request, document_id):
    """Return full workspace data for one document."""
    from document_pipeline.models import Document, ReviewDraft, WorkspaceLock

    try:
        doc = Document.objects.get(pk=document_id)
    except Document.DoesNotExist:
        return _err('Document not found.', 404)

    user = request.user
    lock = _get_lock(document_id)
    is_read_only = not lock or lock.user_id != user.id

    paragraphs = list(
        _live_records(document_id)
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

    user = request.user
    newly_acquired = False

    try:
        with transaction.atomic():
            doc = Document.objects.select_for_update().get(pk=document_id)
            existing = _get_lock(document_id)
            new_status = _status_when_workspace_opened(doc.review_status)

            if existing and existing.user_id != user.id:
                Document.objects.filter(pk=document_id).update(
                    review_status=new_status,
                    current_reviewer=existing.user,
                )
                return _json({
                    'acquired': False,
                    'is_read_only': True,
                    'locked_by': existing.user.username,
                    'locked_by_id': existing.user_id,
                    'expires_at': existing.expires_at.isoformat(),
                    'review_status': new_status,
                })

            if existing and existing.user_id == user.id:
                existing.renew()
                lock = existing
            else:
                # Remove any stale (expired) lock first.
                WorkspaceLock.objects.filter(document_id=document_id).delete()
                lock = WorkspaceLock.objects.create(
                    document_id=document_id, user=user)
                newly_acquired = True

            Document.objects.filter(pk=document_id).update(
                review_status=new_status, current_reviewer=user)
    except Document.DoesNotExist:
        return _err('Document not found.', 404)

    log_activity(
        document_id=document_id,
        phase=DocumentActivityLog.USER_INTERACTION,
        action=DocumentActivityLog.ACT_LOCK_ACQUIRED,
        summary='%s opened the workspace.' % user.username,
        actor_user=user,
    )

    if newly_acquired:
        from realtime.events import publish_document_lock
        publish_document_lock(
            document_id,
            event='document_opened',
            user=user,
            expires_at=lock.expires_at,
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
    try:
        with transaction.atomic():
            Document.objects.select_for_update().get(pk=document_id)
            lock = _get_lock(document_id)
            if not lock or lock.user_id != user.id:
                return _err('No active lock held by you.', 403)

            lock.delete()
            Document.objects.filter(pk=document_id).update(current_reviewer=None)
    except Document.DoesNotExist:
        return _err('Document not found.', 404)

    log_activity(
        document_id=document_id,
        phase=DocumentActivityLog.USER_INTERACTION,
        action=DocumentActivityLog.ACT_LOCK_RELEASED,
        summary='%s closed the workspace.' % user.username,
        actor_user=user,
    )
    from realtime.events import publish_document_lock
    publish_document_lock(document_id, event='document_closed', user=user)
    return _json({'released': True})


@csrf_exempt
@require_auth
@require_http_methods(['POST'])
def lock_request_access(request, document_id):
    """A user requests editing access from the active lock holder."""
    from document_pipeline.models import DocumentActivityLog
    from document_pipeline.activity import log_activity
    from realtime.events import publish_access_event

    user = request.user
    lock = _get_lock(document_id)
    if not lock:
        return _json({'status': 'available', 'message': 'No active lock. You can take editing access directly.'})
    if lock.user_id == user.id:
        return _json({'status': 'editing', 'message': 'You already hold the edit lock.'})

    log_activity(
        document_id=document_id,
        phase=DocumentActivityLog.USER_INTERACTION,
        action='requested_lock',
        summary=f'{user.username} requested editing access from {lock.user.username}.',
        actor_user=user,
    )
    publish_access_event(
        document_id,
        event='access_requested',
        user=user,
        target_user=lock.user,
    )
    return _json({
        'status': 'requested',
        'requested_by': user.username,
        'locked_by': lock.user.username,
    })


@csrf_exempt
@require_auth
@require_http_methods(['POST'])
def lock_respond_access(request, document_id):
    """The active lock holder grants or denies an access request."""
    from core.models import User
    from document_pipeline.models import Document, DocumentActivityLog, WorkspaceLock
    from document_pipeline.activity import log_activity
    from realtime.events import publish_access_event, publish_document_lock

    user = request.user
    try:
        body = json.loads(request.body)
    except (ValueError, TypeError):
        body = {}

    action = body.get('action')  # 'grant' or 'deny'
    target_user_id = body.get('target_user_id')
    if not target_user_id:
        return _err('A target user is required.')
    try:
        target_user_id = uuid.UUID(str(target_user_id))
    except (TypeError, ValueError, AttributeError):
        return _err('Invalid target user ID.')
    target_user = User.objects.filter(pk=target_user_id).first()
    if not target_user:
        return _err('The requesting user no longer exists.', 404)
    if target_user.pk == user.pk:
        return _err('You cannot transfer editing access to yourself.')
    if action not in ('grant', 'deny'):
        return _err('Invalid action. Use "grant" or "deny".', 400)

    try:
        with transaction.atomic():
            document = Document.objects.select_for_update().get(pk=document_id)
            lock = (
                WorkspaceLock.objects.select_for_update()
                .select_related('user')
                .filter(document_id=document_id)
                .first()
            )
            if lock and not lock.is_active:
                lock.delete()
                Document.objects.filter(pk=document_id).update(current_reviewer=None)
                return _err('Your workspace lock has expired. Reopen the document.', 403)
            if not lock or lock.user_id != user.pk:
                return _err('You do not hold the active lock.', 403)

            if action == 'grant':
                lock.user = target_user
                lock.renew()
                lock.save(update_fields=['user'])
                review_status = _status_when_workspace_opened(document.review_status)
                Document.objects.filter(pk=document_id).update(
                    current_reviewer=target_user,
                    review_status=review_status,
                )
            else:
                review_status = document.review_status
    except Document.DoesNotExist:
        return _err('Document not found.', 404)

    if action == 'grant':
        log_activity(
            document_id=document_id,
            phase=DocumentActivityLog.USER_INTERACTION,
            action='granted_lock',
            summary=f'{user.username} granted editing access to {target_user.username}.',
            actor_user=user,
            metadata={'target_user_id': str(target_user.pk)},
        )
        publish_access_event(
            document_id,
            event='access_granted',
            user=user,
            target_user=target_user,
        )
        publish_document_lock(
            document_id,
            event='document_opened',
            user=target_user,
            expires_at=lock.expires_at,
        )
        return _json({
            'status': 'granted',
            'locked_by': target_user.username,
            'locked_by_id': str(target_user.pk),
            'review_status': review_status,
        })

    log_activity(
        document_id=document_id,
        phase=DocumentActivityLog.USER_INTERACTION,
        action='denied_lock',
        summary=f'{user.username} declined editing access request from {target_user.username}.',
        actor_user=user,
        metadata={'target_user_id': str(target_user.pk)},
    )
    publish_access_event(
        document_id,
        event='access_denied',
        user=user,
        target_user=target_user,
    )
    return _json({'status': 'denied'})




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
# Publish (validate + synchronously embed and sync)
# ---------------------------------------------------------------------------

@csrf_exempt
@require_auth
@require_http_methods(['POST'])
def workspace_publish(request, document_id):
    """Validate blockers, then embed and sync before returning."""
    from document_pipeline.tasks.publish import publish_document_task

    user = request.user
    ok, resp = _check_editable(document_id, user)
    if not ok:
        return resp

    # The rule the screen shows, enforced here: the button is only a hint.
    readiness = _publish_readiness(document_id)
    if not readiness['can_publish']:
        return _json(readiness, status=422)

    try:
        body = json.loads(request.body) if request.body else {}
    except (ValueError, TypeError):
        body = {}
    metadata = {
        key: body.get(key) if isinstance(body.get(key), str) else None
        for key in ('agreement_type', 'sectorial_category')
    }

    try:
        result = publish_document_task.apply(
            args=(str(document_id), str(user.id)),
            kwargs=metadata,
            throw=True,
        ).get(propagate=True)
    except Exception as exc:
        return _err('Vector DB publish failed: %s' % exc, 502)

    return _json({
        'queued': False,
        'published': True,
        'result': result,
        'message': (
            'Published to Vector DB: %d records embedded (%d new, %d updated)%s.'
            % (result.get('embedded', 0), result.get('added', 0),
               result.get('updated', 0),
               ', %d deleted removed' % result['removed'] if result.get('removed') else '')
        ),
    })


@require_auth
@require_http_methods(['GET'])
def workspace_publish_status(request, document_id, task_id):
    """Return a queued publish task's state and its final sync statistics."""
    from config.celery import app as celery_app
    from document_pipeline.models import Document

    if not Document.objects.filter(pk=document_id).exists():
        return _err('Document not found.', 404)

    task = celery_app.AsyncResult(str(task_id))
    response = {'task_id': str(task_id), 'state': task.state}
    if task.state == 'SUCCESS':
        result = task.result
        if not isinstance(result, dict) or str(result.get('document_id')) != str(document_id):
            return _err('Publish task not found for this document.', 404)
        response['result'] = result
    elif task.state == 'FAILURE':
        response['detail'] = str(task.result)[:1000]
    return _json(response)


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
    """In-flight pipeline documents, documents awaiting review, and documents
    extraction refused or failed on."""
    from django.db.models import OuterRef, Subquery
    from django.db.models.fields.json import KT
    from document_pipeline.models import Document, ExtractionRun, PipelineStageLog

    # Rejected or failed at extraction: nothing moves these on until the file
    # changes, so they are not in flight. They are listed apart, with the reason.
    stopped = ('rejected', 'failed')

    # In-flight: docs whose latest pipeline stage is not yet complete.
    in_flight = list(
        Document.objects
        .filter(review_status='pending_classification')
        .exclude(extraction_status__in=stopped)
        .order_by('-created_at')[:50]
        .values('id', 'name', 'review_status', 'created_at')
    )

    current_run = ExtractionRun.objects.filter(document=OuterRef('pk'), is_current=True)
    unprocessable = list(
        Document.objects
        .filter(extraction_status__in=stopped, deleted_at__isnull=True)
        .annotate(
            kind=Subquery(current_run.annotate(v=KT('rejection__detected_format')).values('v')[:1]),
            reason=Subquery(current_run.annotate(v=KT('rejection__reason')).values('v')[:1]),
        )
        .order_by('-created_at')[:50]
        .values('id', 'name', 'mime_type', 'extraction_status', 'kind', 'reason', 'created_at')
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
        'unprocessable': unprocessable,
    })


# ---------------------------------------------------------------------------
# Global user-level activity feed  GET /api/activity/
# ---------------------------------------------------------------------------

@require_auth
@require_http_methods(['GET'])
def global_activity_feed(request):
    """Recent activity events across all documents.

    Query params (all optional):
      limit=<n>           max events to return, default 50, cap 200
      user=<username>     filter by actor username
      document_id=<uuid>  filter to one document
      action=<code>       filter by action code (repeatable)
      phase=<code>        filter by phase code (repeatable)
    """
    from document_pipeline.models import DocumentActivityLog

    limit_raw = request.GET.get('limit', '50')
    try:
        limit = min(int(limit_raw), 200)
    except (ValueError, TypeError):
        return _err('limit must be a whole number.')

    qs = (
        DocumentActivityLog.objects
        .select_related('actor_user', 'document')
        .order_by('-created_at')
    )

    if username := (request.GET.get('user') or '').strip():
        qs = qs.filter(actor_user__username__iexact=username)

    if doc_id := (request.GET.get('document_id') or '').strip():
        qs = qs.filter(document_id=doc_id)

    actions = [a for a in request.GET.getlist('action') if a]
    if actions:
        qs = qs.filter(action__in=actions)

    phases = [p for p in request.GET.getlist('phase') if p]
    if phases:
        qs = qs.filter(phase__in=phases)

    events = [
        {
            'id': str(entry.id),
            'document_id': str(entry.document_id),
            'document_name': entry.document.name if entry.document else None,
            'phase': entry.phase,
            'action': entry.action,
            'summary': entry.summary,
            'actor': (
                entry.actor_user.username if entry.actor_user else entry.actor_system
            ),
            'metadata': entry.metadata,
            'created_at': entry.created_at.isoformat(),
        }
        for entry in qs[:limit]
    ]

    return _json({'events': events, 'count': len(events)})
