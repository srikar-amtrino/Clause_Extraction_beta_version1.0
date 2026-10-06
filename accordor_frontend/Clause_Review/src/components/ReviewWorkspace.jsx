import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Chip,
  IconButton,
  Tooltip,
  TextField,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import UndoOutlinedIcon from '@mui/icons-material/UndoOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import HistoryIcon from '@mui/icons-material/History';
import NoteAltOutlinedIcon from '@mui/icons-material/NoteAltOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import RestoreFromTrashIcon from '@mui/icons-material/RestoreFromTrash';

import { documentService } from '../services/documentService';
import { getStoredToken } from '../services/authService';
import { useAuth } from '../context/AuthContext';
import ContentsSidebar from './ContentsSidebar';
import DocumentPreviewPanel from './DocumentPreviewPanel';
import ClauseTable from './ClauseTable';
import DocumentHistory from './DocumentHistory';

function formatBreadcrumbDisplay(text) {
  if (!text) return 'General';
  if (typeof text === 'string' && text === text.toUpperCase() && text.length > 2) {
    const match = text.match(/^(\d+[.)]\s*)(.+)$/);
    if (match) {
      const num = match[1];
      const rest = match[2].toLowerCase();
      return num + rest.charAt(0).toUpperCase() + rest.slice(1);
    }
    const lower = text.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }
  return text;
}

function resolveTaxonomyKey(typeOrName, taxonomyMap) {
  if (!typeOrName || typeOrName === 'Unassigned' || typeOrName === 'unassigned') return null;
  const raw = String(typeOrName).trim();
  const lower = raw.toLowerCase();
  if (taxonomyMap && taxonomyMap.has(lower)) {
    return taxonomyMap.get(lower);
  }
  return lower
    .replace(/\s*&\s*/g, '-and-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function mapClassificationItem(item, i, doc, classRes) {
  const clauseId = item.clause_id || (item.number ? `c${item.number}` : `c${i + 1}`);
  const breadcrumb =
    item.breadcrumb || item.heading_trail || item.heading || (item.number ? `Clause ${item.number}` : `Clause ${i + 1}`);
  const reviewObj = item.review || null;
  const isItemReviewed = Boolean(reviewObj?.decision || item.needs_review === false || item.isReviewed);
  const itemNeedsReview = isItemReviewed ? false : Boolean(item.needs_review !== false && (item.needs_review || item.needsReview));
  return {
    id: item.classification_id || item.id || `clause-${i}`,
    classification_id: item.classification_id,
    clause_id: clauseId,
    paraId: clauseId,
    number: item.number,
    paragraph_ids: item.paragraph_ids || [],
    heading_trail: breadcrumb,
    breadcrumb: breadcrumb,
    text: item.text || item.chunk_text || '',
    reviewed_text: item.reviewed_text || item.text || item.chunk_text || '',
    label: item.label || 'Clause',
    type: item.type || 'unassigned',
    type_name: item.type_name || item.type || 'Unassigned',
    canonicalType: item.type_name || item.type || 'Unassigned',
    sub_type: item.sub_type || null,
    subType: item.sub_type || null,
    preview: item.preview || doc?.webViewLink || classRes?.document?.drive_web_link || '',
    confidence: item.confidence,
    needs_review: itemNeedsReview,
    needsReview: itemNeedsReview,
    isReviewed: isItemReviewed,
    review_reasons: isItemReviewed ? [] : (item.review_reasons || []),
    deviated: isItemReviewed ? false : Boolean(item.deviated),
    outcome: isItemReviewed ? 'reviewed' : item.outcome,
    expected_types: item.expected_types || [],
    review: reviewObj,
    decision: reviewObj?.decision || (itemNeedsReview ? 'needs_review' : 'accepted'),
    note: reviewObj?.note || '',
    merged_into: item.merged_into || null,
    deleted_at: item.deleted_at || null,
    deleted_by: item.deleted_by || null,
  };
}

export default function ReviewWorkspace({
  document: doc,
  onBackToDocuments,
  showToast,
  isSidebarCollapsed = false,
  onToggleSidebar,
  onUpdateDocument,
}) {
  const { currentUser } = useAuth();
  const currentUserId = currentUser?.id;
  const currentUserName =
    currentUser?.username || currentUser?.name || (currentUser?.email ? currentUser.email.split('@')[0] : 'Reviewer');
  const docId = doc?.documentId || doc?.id || '';

  const currentUserIdRef = useRef(currentUserId);
  const lockEffectDocumentIdRef = useRef(docId);
  const [workspaceLock, setWorkspaceLock] = useState({ status: 'connecting', documentId: docId });
  const lockOwnedRef = useRef(false);
  const heartbeatRef = useRef(null);
  const lockEffectGenerationRef = useRef(0);
  const socketRef = useRef(null);
  const [isRequestingAccess, setIsRequestingAccess] = useState(false);
  const [incomingAccessRequest, setIncomingAccessRequest] = useState(null);

  const handleHeartbeatFailure = useCallback(
    (error) => {
      if (error.status !== 403) return;
      lockOwnedRef.current = false;
      if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
      setWorkspaceLock({ status: 'error', documentId: docId });
    },
    [docId]
  );

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
    lockEffectDocumentIdRef.current = docId;
  }, [currentUserId, docId]);

  // Clean legacy local storage caches on workspace mount
  useEffect(() => {
    try {
      localStorage.removeItem('accordor_cached_documents_v1');
      if (docId) {
        localStorage.removeItem(`accordor_saved_clauses_${docId}`);
        localStorage.removeItem(`clausewright_doc_note_${docId}`);
      }
    } catch (_) {}
  }, [docId]);

  // Workspace WebSocket lock lifecycle
  useEffect(() => {
    if (!docId) return undefined;

    const effectGeneration = ++lockEffectGenerationRef.current;
    let active = true;
    let socket;
    let reconnectTimer;
    let reconnectAttempts = 0;
    let releasedDuringCleanup = false;
    const token = getStoredToken();

    const setHeartbeat = () => {
      if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = window.setInterval(() => {
        documentService.heartbeatWorkspaceLock(docId).catch(handleHeartbeatFailure);
      }, 60000);
    };

    const connectSocket = () => {
      if (!active || !token) return;
      socket = new WebSocket(documentService.websocketUrl(docId), ['bearer', token]);
      socketRef.current = socket;
      socket.onopen = () => {
        reconnectAttempts = 0;
      };
      socket.onmessage = (message) => {
        let update;
        try {
          update = JSON.parse(message.data);
        } catch {
          return;
        }

        // Access handover events
        if (update.event === 'access_requested') {
          // If I am the active editor and someone else requested access
          const requester = update.requested_by;
          if (
            lockOwnedRef.current &&
            requester &&
            String(requester).toLowerCase() !== String(currentUserName).toLowerCase()
          ) {
            setIncomingAccessRequest({
              requestedBy: requester,
              requestedById: update.requested_by_id,
            });
          }
          return;
        }

        if (update.event === 'access_granted') {
          const isTargetedToMe =
            String(update.target_user_id) === String(currentUserIdRef.current) ||
            (update.target_user && String(update.target_user).toLowerCase() === String(currentUserName).toLowerCase());
          if (isTargetedToMe) {
            setIsRequestingAccess(false);
            showToast?.(`${update.granted_by || 'The editor'} granted editing access! Taking over…`, 'success');
            handleTakeEditingAccess();
          }
          return;
        }

        if (update.event === 'access_denied') {
          const isTargetedToMe =
            String(update.target_user_id) === String(currentUserIdRef.current) ||
            (update.target_user && String(update.target_user).toLowerCase() === String(currentUserName).toLowerCase());
          if (isTargetedToMe) {
            setIsRequestingAccess(false);
            showToast?.(`${update.denied_by || 'The editor'} is currently editing and declined the handover request.`, 'warning');
          }
          return;
        }

        if (!['lock_state', 'document_opened', 'document_closed'].includes(update.event)) return;

        if (update.event === 'document_closed') {
          lockOwnedRef.current = false;
          if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
          setWorkspaceLock({ status: 'available', closedBy: update.closed_by, documentId: docId });
          return;
        }

        if (update.locked) {
          const isMine =
            String(update.locked_by_id) === String(currentUserIdRef.current) ||
            (update.locked_by && String(update.locked_by).toLowerCase() === String(currentUserName).toLowerCase());
          lockOwnedRef.current = isMine;
          if (isMine) setHeartbeat();
          setWorkspaceLock({
            status: isMine ? 'editing' : 'read-only',
            lockedBy: update.locked_by,
            documentId: docId,
          });
        } else {
          lockOwnedRef.current = false;
          setWorkspaceLock({ status: 'available', closedBy: update.closed_by, documentId: docId });
        }
      };
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        if (active) {
          const delay = Math.min(2000 * 2 ** reconnectAttempts, 30000);
          reconnectAttempts += 1;
          reconnectTimer = window.setTimeout(connectSocket, delay);
        }
      };
    };

    connectSocket();
    documentService
      .acquireWorkspaceLock(docId)
      .then((result) => {
        const isEditing = Boolean(
          result?.acquired === true ||
          result?.is_read_only === false ||
          result?.status === 'editing' ||
          (result?.locked_by && String(result.locked_by).toLowerCase() === String(currentUserName).toLowerCase())
        );
        const finalStatus = isEditing ? 'editing' : (result?.status || 'read-only');
        const finalLockedBy = isEditing ? currentUserName : (result?.locked_by || '');

        if (!active) {
          const replayedForSameDocument =
            lockEffectGenerationRef.current !== effectGeneration &&
            lockEffectDocumentIdRef.current === docId;
          if (finalStatus === 'editing' && !replayedForSameDocument) {
            documentService.releaseWorkspaceLock(docId, { keepalive: true }).catch(() => {});
          }
          return;
        }
        lockOwnedRef.current = finalStatus === 'editing';
        if (finalStatus === 'editing') setHeartbeat();
        setWorkspaceLock({
          status: finalStatus,
          lockedBy: finalLockedBy,
          closedBy: result?.closed_by,
          documentId: docId,
        });
      })
      .catch((error) => {
        if (!active) return;
        lockOwnedRef.current = false;
        setWorkspaceLock({ status: 'error', documentId: docId });
        showToast?.(error.message || 'Could not acquire document access.');
      });

    return () => {
      active = false;
      if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
      if (lockOwnedRef.current && !releasedDuringCleanup) {
        releasedDuringCleanup = true;
        lockOwnedRef.current = false;
        documentService.releaseWorkspaceLock(docId, { keepalive: true }).catch(() => {});
      }
    };
  }, [docId, handleHeartbeatFailure, showToast, currentUserName]);

  // Fire a lock-release beacon on hard page unload (tab close, browser close,
  // direct URL navigation). navigator.sendBeacon is queued by the browser and
  // survives page teardown; keepalive fetch above covers React unmount.
  useEffect(() => {
    if (!docId) return undefined;

    const handleUnload = () => {
      if (!lockOwnedRef.current) return; // read-only visitor — nothing to release
      const token = getStoredToken();
      const url = `/api/documents/${docId}/workspace/lock/release/`;
      // sendBeacon ignores the response; the backend is idempotent on 403.
      if (navigator.sendBeacon) {
        const blob = new Blob(['{}'], { type: 'application/json' });
        // Attach auth token as a query param so the Django backend can auth the
        // beacon request (sendBeacon cannot set custom headers).
        navigator.sendBeacon(`${url}?token=${encodeURIComponent(token || '')}`, blob);
      }
    };

    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [docId]);

  const handleTakeEditingAccess = async () => {
    try {
      const result = await documentService.acquireWorkspaceLock(docId, { takeOver: true });
      const isEditing = Boolean(
        result?.acquired === true ||
        result?.is_read_only === false ||
        result?.status === 'editing' ||
        (result?.locked_by && String(result.locked_by).toLowerCase() === String(currentUserName).toLowerCase())
      );
      const finalStatus = isEditing ? 'editing' : (result?.status || 'read-only');
      const finalLockedBy = isEditing ? currentUserName : (result?.locked_by || '');

      lockOwnedRef.current = finalStatus === 'editing';
      if (finalStatus === 'editing') setHeartbeat();
      setWorkspaceLock({ status: finalStatus, lockedBy: finalLockedBy, documentId: docId });
      showToast?.('Editing access acquired.', 'success');
    } catch (err) {
      showToast?.(err.message || 'Could not take editing access.', 'error');
    }
  };

  const handleRequestEditingAccess = async () => {
    setIsRequestingAccess(true);
    try {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ event: 'request_access' }));
      }
      const res = await documentService.requestWorkspaceAccess(docId);
      if (res?.status === 'available') {
        showToast?.('Document is now available. Acquiring editing access…', 'success');
        handleTakeEditingAccess();
        setIsRequestingAccess(false);
        return;
      }
      showToast?.(`Access request sent to ${workspaceLock.lockedBy || 'the reviewer'}. Waiting for response…`, 'info');
    } catch (err) {
      setIsRequestingAccess(false);
      showToast?.(err.message || 'Could not send access request.', 'error');
    }
  };

  const handleGrantAccessToRequester = async () => {
    if (!incomingAccessRequest) return;
    const { requestedBy, requestedById } = incomingAccessRequest;
    try {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({
          event: 'grant_access',
          target_user: requestedBy,
          target_user_id: requestedById,
        }));
      }
      await documentService.respondWorkspaceAccess(docId, 'grant', requestedById, requestedBy);
      lockOwnedRef.current = false;
      if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
      setWorkspaceLock({ status: 'read-only', lockedBy: requestedBy, documentId: docId });
      setIncomingAccessRequest(null);
      showToast?.(`Editing access granted to ${requestedBy}. Document is now read-only.`, 'success');
    } catch (err) {
      showToast?.(err.message || 'Could not grant editing access.', 'error');
    }
  };

  const handleDeclineAccessRequest = async () => {
    if (!incomingAccessRequest) return;
    const { requestedBy, requestedById } = incomingAccessRequest;
    try {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({
          event: 'deny_access',
          target_user: requestedBy,
          target_user_id: requestedById,
        }));
      }
      await documentService.respondWorkspaceAccess(docId, 'deny', requestedById, requestedBy);
      setIncomingAccessRequest(null);
      showToast?.(`Declined access request from ${requestedBy}.`, 'info');
    } catch {
      setIncomingAccessRequest(null);
    }
  };

  const canEdit = workspaceLock.status === 'editing';

  // Navigation tabs: 'review' | 'history' | 'note'
  const [activeTab, setActiveTab] = useState('review');
  const [historyEventCount, setHistoryEventCount] = useState(0);

  // Fetch initial activity count for tab badge
  useEffect(() => {
    if (!docId) return;
    let isMounted = true;
    documentService
      .getDocumentActivity(docId)
      .then((res) => {
        if (!isMounted || !res) return;
        let total = 0;
        if (res.phases && Array.isArray(res.phases)) {
          res.phases.forEach((p) => {
            if (Array.isArray(p.events)) total += p.events.length;
          });
        } else if (Array.isArray(res)) {
          total = res.length;
        } else if (Array.isArray(res.events)) {
          total = res.events.length;
        } else if (Array.isArray(res.activities)) {
          total = res.activities.length;
        } else if (Array.isArray(res.results)) {
          total = res.results.length;
        }
        setHistoryEventCount(total);
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [docId]);

  // Filter toolbar state
  const [activeFilter, setActiveFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Row selection
  const [selectedRows, setSelectedRows] = useState([]);

  // Data states
  const [extractedClauses, setExtractedClauses] = useState([]);
  const [deletedClauses, setDeletedClauses] = useState([]);
  const [deleteModalState, setDeleteModalState] = useState({
    open: false,
    clause: null,
    clauses: [],
    mergeIntoNext: false,
    note: '',
    isDeleting: false,
  });
  const [classificationSummary, setClassificationSummary] = useState(null);
  const [classificationRunId, setClassificationRunId] = useState(null);
  const [documentMeta, setDocumentMeta] = useState(null);
  const [isLoadingClauses, setIsLoadingClauses] = useState(false);
  const [isPublishingToVectorDb, setIsPublishingToVectorDb] = useState(false);
  const [documentStatus, setDocumentStatus] = useState(doc?.status || 'Needs review');
  const [lastSavedTimestamp, setLastSavedTimestamp] = useState(doc?.lastSaved || null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSavingClassification, setIsSavingClassification] = useState(false);

  const needsReviewCount = useMemo(() => {
    return extractedClauses.filter(
      (r) => !r.review?.decision && !r.isReviewed && (r.needs_review || r.needsReview || r.decision === 'needs_review')
    ).length;
  }, [extractedClauses]);

  const reviewedCount = useMemo(() => {
    return extractedClauses.filter(
      (r) => Boolean(r.review?.decision || r.isReviewed || (!r.needs_review && !r.needsReview))
    ).length;
  }, [extractedClauses]);

  useEffect(() => {
    if (doc?.status) {
      setDocumentStatus(doc.status);
    }
    if (doc?.lastSaved) {
      setLastSavedTimestamp(doc.lastSaved);
    }
  }, [doc?.status, doc?.lastSaved]);

  const handlePublishToVectorDb = async () => {
    const targetDocId = doc?.documentId || doc?.id || docId;
    if (!targetDocId || isPublishingToVectorDb) return;
    setIsPublishingToVectorDb(true);
    try {
      const deletedIds = new Set(
        (deletedClauses || []).map((d) => String(d.classification_id || d.id || d.clause_id))
      );

      const activeClauses = extractedClauses
        .filter((c) => !deletedIds.has(String(c.classification_id || c.id || c.clause_id)))
        .map((c, idx) => ({
          classification_id: c.classification_id || c.id,
          clause_id: c.clause_id || (c.number ? `c${c.number}` : `c${idx + 1}`),
          number: c.number,
          paragraph_ids: c.paragraph_ids || [],
          breadcrumb: c.breadcrumb || c.heading_trail || '',
          heading_trail: c.heading_trail || c.breadcrumb || '',
          text: (c.reviewed_text || c.text || '').trim(),
          reviewed_text: (c.reviewed_text || c.text || '').trim(),
          label: c.label || 'Clause',
          type: c.type || null,
          type_name: c.type_name || c.canonicalType || 'Unassigned',
          sub_type: c.sub_type || null,
          decision: c.review?.decision || c.decision || 'accepted',
        }));

      const activeAgreementType = doc?.agreement_type || doc?.agreementType || documentMeta?.agreement_type || documentMeta?.agreementType || '';
      const activeSectorialCategory = doc?.sectorial_category || doc?.sectorial || documentMeta?.sectorial_category || documentMeta?.sectorial || '';

      const publishPayload = {
        classification_run_id: classificationRunId,
        agreement_type: activeAgreementType,
        sectorial_category: activeSectorialCategory,
        clauses: activeClauses,
        items: activeClauses,
      };

      const result = await documentService.publishToVectorDb(targetDocId, publishPayload);
      const msg = result?.message || `Published "${docName}" (${activeClauses.length} clauses) to Vector DB successfully.`;
      showToast?.(msg, 'success');
      const updatedPublishDoc = {
        ...doc,
        status: 'Updated to vector DB',
        review_status: 'published',
        vectorDbStatus: 'Updated to vector DB',
        isPublished: true,
        agreement_type: activeAgreementType,
        sectorial_category: activeSectorialCategory,
      };
      if (onUpdateDocument) {
        onUpdateDocument(updatedPublishDoc);
      }
      window.dispatchEvent(
        new CustomEvent('document_saved', {
          detail: {
            documentId: targetDocId,
            status: 'Updated to vector DB',
            doc: updatedPublishDoc,
          },
        })
      );
    } catch (error) {
      console.error('Vector DB publish error:', error);
      const blockers = error.data?.blockers;
      showToast?.(
        blockers?.length
          ? `Cannot publish: ${blockers.join(', ')}`
          : (error.data?.detail || error.message || 'Could not publish to vector database.'),
        'error'
      );
    } finally {
      setIsPublishingToVectorDb(false);
    }
  };

  // Contents Drawer & Preview State
  const [isContentsOpen, setIsContentsOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState(() => new Set([1, 2, 3]));
  const [highlightedClauseId, setHighlightedClauseId] = useState(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewClause, setPreviewClause] = useState(null);
  const previewContainerRef = useRef(null);

  const taxonomyMapRef = useRef(new Map());

  // Available canonical taxonomy types
  const [availableCanonicalTypes, setAvailableCanonicalTypes] = useState([
    'Unassigned',
    'Definitions & Interpretation',
    'Purpose & Scope of Services',
    'Customer Obligations',
    'Service Provider Obligations',
    'Term & Renewal',
    'Fees & Payment',
    'Confidentiality',
    'Data Protection & Privacy',
    'Intellectual Property',
    'Representations & Warranties',
    'Indemnification',
    'Limitation of Liability',
    'Suspension & Termination',
    'Force Majeure',
    'Governing Law & Dispute Resolution',
    'Notices',
  ]);

  useEffect(() => {
    let isMounted = true;
    if (typeof documentService?.taxonomy === 'function') {
      documentService
        .taxonomy()
        .then((res) => {
          if (!isMounted || !res) return;
          const clauseList = Array.isArray(res.clause_types) ? res.clause_types : [];
          const nonClauseList = Array.isArray(res.non_clause_types) ? res.non_clause_types : [];
          const allTypes = [...clauseList, ...nonClauseList];

          const map = new Map();
          allTypes.forEach((t) => {
            if (t.name && t.key) {
              map.set(t.name.toLowerCase().trim(), t.key);
              map.set(t.key.toLowerCase().trim(), t.key);
            }
          });
          taxonomyMapRef.current = map;

          if (clauseList.length > 0) {
            const names = clauseList.map((t) => t.name).filter(Boolean);
            setAvailableCanonicalTypes(['Unassigned', ...names]);
          }
        })
        .catch(() => {});
    }
    return () => {
      isMounted = false;
    };
  }, []);

  // Immediately initialize clauses if pre-fetched classification or sessionStorage cache is available (0ms buffering)
  useEffect(() => {
    const targetDocId = docId || doc?.documentId || doc?.id;
    if (!targetDocId) return;

    let initialData = doc?._initialClassification;
    if (!initialData || !Array.isArray(initialData.items) || initialData.items.length === 0) {
      try {
        const cached = sessionStorage.getItem('accordor_class_cache_' + targetDocId);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
            initialData = parsed;
          }
        }
      } catch (_) {}
    }

    if (initialData && Array.isArray(initialData.items) && initialData.items.length > 0) {
      const initRows = initialData.items.map((item, i) =>
        mapClassificationItem(item, i, doc, initialData)
      );
      setExtractedClauses(initRows);
      if (Array.isArray(initialData.deleted_items)) {
        setDeletedClauses(
          initialData.deleted_items.map((item, i) =>
            mapClassificationItem(item, i, doc, initialData)
          )
        );
      }
      if (initRows.length > 0) {
        setPreviewClause(initRows[0]);
        setHighlightedClauseId(initRows[0].id || initRows[0].clause_id);
      }
      if (initialData.summary) {
        setClassificationSummary(initialData.summary);
      }
      if (initialData.document) {
        setDocumentMeta(initialData.document);
      }
      const runId =
        initialData.classification_run?.classification_run_id ||
        initialData.classification_run?.id ||
        initialData.classification_run_id ||
        initialData.summary?.classification_run_id;
      if (runId) setClassificationRunId(runId);
      setIsLoadingClauses(false);
    }
  }, [docId, doc]);

  // Keep first clause selected and highlighted in preview when clauses are ready
  useEffect(() => {
    if (extractedClauses.length > 0 && !previewClause) {
      setPreviewClause(extractedClauses[0]);
      setHighlightedClauseId(extractedClauses[0].id || extractedClauses[0].clause_id || extractedClauses[0].paraId);
    }
  }, [extractedClauses, previewClause]);

  // Load classification items directly from backend API (revalidates in background without blocking if cached)
  useEffect(() => {
    let isMounted = true;
    if (!docId) return;

    // Check if we already have cached data in sessionStorage
    let hasCachedData = false;
    try {
      const cached = sessionStorage.getItem('accordor_class_cache_' + docId);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
          hasCachedData = true;
        }
      }
    } catch (_) {}

    if (!hasCachedData && extractedClauses.length === 0) {
      setIsLoadingClauses(true);
    }

    async function fetchClassification() {
      try {
        // Fetch full document metadata if doc is loading or missing attributes
        if (!doc?.folder || doc?.name === 'Loading Document...' || !doc?.pages) {
          documentService.get(docId).then((fullDoc) => {
            if (isMounted && fullDoc) {
              setDocumentMeta(fullDoc);
              if (onUpdateDocument) {
                onUpdateDocument({ ...doc, ...fullDoc, id: fullDoc.id || docId, documentId: fullDoc.id || docId });
              }
            }
          }).catch(() => {});
        }

        let classRes = await documentService.classification(docId).catch((err) => {
          console.warn('Direct document classification read:', err);
          return null;
        });

        if (!classRes || !classRes.items || classRes.items.length === 0) {
          const docListRes = await documentService.list({ limit: 100 }).catch(() => null);
          const altDoc = docListRes?.documents?.find(
            (d) =>
              (d.name || d.fileName || '').trim().toLowerCase() === (doc?.name || doc?.fileName || '').trim().toLowerCase()
          );
          if (altDoc && altDoc.document_id) {
            const altRes = await documentService.classification(altDoc.document_id).catch(() => null);
            if (altRes && altRes.items && altRes.items.length > 0) {
              classRes = altRes;
            }
          }
        }

        if (classRes && Array.isArray(classRes.items) && classRes.items.length > 0) {
          // Store in sessionStorage cache for instant reload / reopen
          try {
            sessionStorage.setItem('accordor_class_cache_' + docId, JSON.stringify(classRes));
          } catch (_) {}

          const runId =
            classRes.classification_run?.classification_run_id ||
            classRes.classification_run?.id ||
            classRes.classification_run_id ||
            classRes.summary?.classification_run_id ||
            null;
          if (runId) {
            setClassificationRunId(runId);
          }

          const rows = classRes.items.map((item, i) => mapClassificationItem(item, i, doc, classRes));
          const deletedRows = Array.isArray(classRes.deleted_items)
            ? classRes.deleted_items.map((item, i) => mapClassificationItem(item, i, doc, classRes))
            : [];

          if (isMounted) {
            setExtractedClauses(rows);
            setDeletedClauses(deletedRows);
            if (rows.length > 0 && !previewClause) {
              setPreviewClause(rows[0]);
              setHighlightedClauseId(rows[0].id || rows[0].clause_id);
            }
            if (classRes.summary) {
              setClassificationSummary(classRes.summary);
            }
            if (classRes.document) {
              setDocumentMeta(classRes.document);
            }
          }
        } else if (isMounted && extractedClauses.length === 0) {
          setExtractedClauses([]);
        }
      } catch (err) {
        console.error('Failed to load classifications:', err);
      } finally {
        if (isMounted) setIsLoadingClauses(false);
      }
    }

    fetchClassification();
    return () => {
      isMounted = false;
    };
  }, [docId, doc]);

  // Document Note: Loaded and saved directly through backend API
  const [documentNote, setDocumentNote] = useState('');
  const [noteSavedAt, setNoteSavedAt] = useState(null);

  useEffect(() => {
    if (!docId) return;
    let isMounted = true;
    documentService
      .getDocumentNote(docId)
      .then((res) => {
        if (isMounted && res) {
          setDocumentNote(res.text || '');
          if (res.updated_at) {
            setNoteSavedAt(new Date(res.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
          }
        }
      })
      .catch(() => {
        if (isMounted) setDocumentNote(doc?.documentNote || doc?.note || '');
      });
    return () => {
      isMounted = false;
    };
  }, [docId, doc]);

  const handleSaveDocumentNote = async () => {
    if (!docId) return;
    try {
      const res = await documentService.saveDocumentNote(docId, documentNote);
      setNoteSavedAt(
        new Date(res?.updated_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      );
      showToast?.(`Document note saved for ${doc?.name || 'Document'}`, 'success');
    } catch (err) {
      console.warn('Saving note error:', err);
      showToast?.('Could not save note to server', 'error');
    }
  };

  // Row update helper
  const handleUpdateRow = (rowId, updates) => {
    const targetKey = String(rowId);
    setExtractedClauses((prev) =>
      prev.map((row) => {
        if (
          String(row.id) === targetKey ||
          String(row.clause_id) === targetKey ||
          String(row.paraId) === targetKey ||
          String(row.classification_id) === targetKey
        ) {
          return {
            ...row,
            ...updates,
            isLocallyEdited: true,
            decision: updates.decision || (row.decision === 'rejected' ? 'rejected' : 'corrected'),
          };
        }
        return row;
      })
    );
    // Auto-select the edited row's checkbox so it is ready to save
    setSelectedRows((prev) => {
      const prevStrings = prev.map(String);
      return prevStrings.includes(targetKey) ? prev : [...prev, targetKey];
    });
    setHasUnsavedChanges(true);
  };

  // Row Selection Handlers
  const handleSelectAll = (keysOrEvent, maybeEvent) => {
    if (Array.isArray(keysOrEvent)) {
      const keys = keysOrEvent.map(String);
      setSelectedRows((prev) => {
        const prevStrings = prev.map(String);
        const allPresent = keys.length > 0 && keys.every((k) => prevStrings.includes(k));
        if (allPresent) {
          return prev.filter((k) => !keys.includes(String(k)));
        } else {
          return Array.from(new Set([...prevStrings, ...keys]));
        }
      });
    } else if (keysOrEvent?.target) {
      if (keysOrEvent.target.checked) {
        setSelectedRows(extractedClauses.map((r) => String(r.classification_id || r.id || r.clause_id)).filter(Boolean));
      } else {
        setSelectedRows([]);
      }
    }
  };

  const handleToggleRow = (rowKey) => {
    const key = String(rowKey);
    setSelectedRows((prev) => {
      const prevStrings = prev.map(String);
      if (prevStrings.includes(key)) {
        return prev.filter((k) => String(k) !== key);
      } else {
        return [...prev, key];
      }
    });
  };

  // Highlight and Scroll Handler
  const handleHighlightClause = (targetId, row) => {
    setHighlightedClauseId(targetId);
    setPreviewClause(row);
    if (isPreviewOpen) {
      setTimeout(() => {
        const previewEl = document.getElementById(`doc-preview-clause-${targetId}`);
        if (previewEl) {
          previewEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 50);
    }
  };

  const handleOpenPreview = (clause) => {
    const targetId = clause.id || clause.clause_id || clause.paraId;
    setPreviewClause(clause);
    setHighlightedClauseId(targetId);
    setIsPreviewOpen(true);
    setTimeout(() => {
      const el = document.getElementById(`doc-preview-clause-${targetId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
  };

  // Hierarchical Contents tree
  const contentsTree = useMemo(() => {
    if (!extractedClauses || extractedClauses.length === 0) return [];
    const groups = [];

    extractedClauses.forEach((clause, index) => {
      let topTitle = '';
      let subTitle = '';
      const bCrumb = clause.breadcrumb || clause.heading_trail || '';

      if (bCrumb.includes(' > ')) {
        const parts = bCrumb.split(' > ').map((s) => s.trim()).filter(Boolean);
        topTitle = parts[0];
        subTitle = parts.slice(1).join(' › ');
      } else if (clause.heading_trail) {
        topTitle = clause.heading_trail.trim();
      } else if (clause.breadcrumb) {
        topTitle = clause.breadcrumb.trim();
      } else {
        topTitle = 'GENERAL CLAUSES';
      }

      let sectionNum = null;
      const numMatch = topTitle.match(/^(\d+)[.\s]+(.*)$/);
      if (numMatch) {
        sectionNum = parseInt(numMatch[1], 10);
        topTitle = numMatch[2].trim();
      }

      const cIdStr = String(clause.clause_id || clause.number || '');
      const dotMatch = cIdStr.match(/^(\d+)\.(\d+)/);
      if (dotMatch && sectionNum === null) {
        sectionNum = parseInt(dotMatch[1], 10);
      }

      const groupKey = sectionNum !== null ? `sec_${sectionNum}` : `sec_title_${topTitle.toUpperCase()}`;
      let targetGroup = groups.find((g) => g.key === groupKey);
      if (!targetGroup) {
        targetGroup = {
          key: groupKey,
          rawNum: sectionNum,
          title: topTitle.toUpperCase(),
          clauses: [],
        };
        groups.push(targetGroup);
      }

      targetGroup.clauses.push({
        clause,
        index,
        subTitle:
          subTitle ||
          (clause.type_name && clause.type_name !== 'Unassigned' ? clause.type_name : `Clause ${index + 1}`),
        dotMatchSub: dotMatch ? dotMatch[0] : null,
      });
    });

    return groups.map((g, gIdx) => {
      const secNum = g.rawNum !== null ? g.rawNum : gIdx + 1;
      const children = g.clauses.map((item, itemIdx) => {
        const childNum = item.dotMatchSub || `${secNum}.${itemIdx + 1}`;
        let label = item.subTitle;
        if (!label || label === 'Unassigned' || label === `Clause ${item.index + 1}`) {
          if (item.clause.type_name && item.clause.type_name !== 'Unassigned') {
            label = item.clause.type_name;
          } else if (item.clause.text) {
            label = item.clause.text.slice(0, 45).replace(/[\r\n]+/g, ' ') + '...';
          } else {
            label = `Clause ${childNum}`;
          }
        }
        return {
          id: item.clause.id,
          clause_id: item.clause.clause_id,
          paraId: item.clause.paraId,
          number: childNum,
          label: formatBreadcrumbDisplay(label),
          clause: item.clause,
        };
      });

      return {
        key: g.key,
        number: secNum,
        title: g.title || `Section ${secNum}`,
        firstClause: g.clauses[0]?.clause,
        firstClauseId: g.clauses[0]?.clause?.id,
        children,
      };
    });
  }, [extractedClauses]);

  const toggleSection = (secNum) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(secNum)) next.delete(secNum);
      else next.add(secNum);
      return next;
    });
  };

  const handleToggleContents = () => {
    setIsContentsOpen((prev) => !prev);
  };

  const handleContentsClauseClick = (clause) => {
    if (!clause) return;
    const rowId = clause.id || clause.clause_id || clause.paraId;
    setHighlightedClauseId(rowId);
    const rowEl = document.getElementById(`table-clause-row-${rowId}`);
    if (rowEl) rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (isPreviewOpen) {
      setPreviewClause(clause);
      const previewEl = document.getElementById(`doc-preview-clause-${rowId}`);
      if (previewEl) previewEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleSectionClick = (sec) => {
    toggleSection(sec.number);
    if (sec.firstClause) handleContentsClauseClick(sec.firstClause);
  };

  const previewClauseIndex = useMemo(() => {
    if (!previewClause) return -1;
    return extractedClauses.findIndex(
      (c) =>
        (c.id && c.id === previewClause.id) ||
        (c.clause_id && c.clause_id === previewClause.clause_id) ||
        (c.paraId && c.paraId === previewClause.paraId)
    );
  }, [previewClause, extractedClauses]);

  const handlePrevPreviewClause = () => {
    if (previewClauseIndex > 0) {
      const prevClause = extractedClauses[previewClauseIndex - 1];
      setPreviewClause(prevClause);
      const targetId = prevClause.id || prevClause.clause_id || prevClause.paraId;
      setHighlightedClauseId(targetId);
      const el = document.getElementById(`doc-preview-clause-${targetId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleNextPreviewClause = () => {
    if (previewClauseIndex < extractedClauses.length - 1 && previewClauseIndex !== -1) {
      const nextClause = extractedClauses[previewClauseIndex + 1];
      setPreviewClause(nextClause);
      const targetId = nextClause.id || nextClause.clause_id || nextClause.paraId;
      setHighlightedClauseId(targetId);
      const el = document.getElementById(`doc-preview-clause-${targetId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // Save Classification decisions directly to the API
  const handleSaveClassification = async () => {
    const targetDocId = doc?.documentId || doc?.id || docId;
    if (!targetDocId) {
      showToast?.('No document ID found.', 'error');
      return;
    }

    if (!canEdit) {
      try {
        const lockRes = await documentService.acquireWorkspaceLock(targetDocId);
        const isEditing = Boolean(
          lockRes?.acquired === true ||
          lockRes?.is_read_only === false ||
          lockRes?.status === 'editing' ||
          (lockRes?.locked_by && String(lockRes.locked_by).toLowerCase() === String(currentUserName).toLowerCase())
        );
        if (isEditing) {
          lockOwnedRef.current = true;
          setWorkspaceLock({ status: 'editing', lockedBy: currentUserName, documentId: targetDocId });
        }
      } catch (_) {
        showToast?.('Document is read-only. Cannot save changes.', 'warning');
        return;
      }
    }

    setIsSavingClassification(true);
    try {
      let runId = classificationRunId;
      if (!runId) {
        const classInfo = await documentService.classification(targetDocId).catch(() => null);
        runId =
          classInfo?.classification_run?.classification_run_id ||
          classInfo?.classification_run?.id ||
          classInfo?.classification_run_id ||
          classInfo?.summary?.classification_run_id;
        if (runId) setClassificationRunId(runId);
      }

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const selectedKeySet = new Set(selectedRows.map(String));
      const rowsToSave = selectedRows.length > 0
        ? extractedClauses.filter((row, idx) =>
            selectedKeySet.has(String(row.classification_id)) ||
            selectedKeySet.has(String(row.id)) ||
            selectedKeySet.has(String(row.clause_id)) ||
            selectedKeySet.has(String(row.paraId)) ||
            selectedKeySet.has(String(idx))
          )
        : extractedClauses.filter((row) => row.isLocallyEdited || row.is_text_modified);

      const itemsToProcess = rowsToSave.length > 0 ? rowsToSave : extractedClauses;

      const validItems = itemsToProcess
        .filter((row) => {
          const cid = row.classification_id || row.id;
          return Boolean(cid);
        })
        .map((row) => {
          const cid = row.classification_id || row.id;
          const label = row.label === 'Non-clause' ? 'Non-clause' : 'Clause';
          let typeKey = resolveTaxonomyKey(row.type, taxonomyMapRef.current);
          if (!typeKey && (row.type_name || row.canonicalType)) {
            typeKey = resolveTaxonomyKey(row.type_name || row.canonicalType, taxonomyMapRef.current);
          }
          const textVal = (row.reviewed_text || row.text || '').trim();
          const origText = (row.text || '').trim();

          const isModified = Boolean(
            row.isLocallyEdited ||
            row.is_text_modified ||
            (row.reviewed_text && row.text && row.reviewed_text.trim() !== row.text.trim())
          );
          let decision = 'accepted';
          if (row.decision === 'rejected') {
            decision = 'rejected';
          } else if (isModified || row.decision === 'corrected') {
            decision = 'corrected';
          } else {
            decision = 'accepted';
          }

          const itemPayload = {
            classification_id: cid,
            label,
            type: typeKey || row.type || 'unassigned',
            sub_type: label !== 'Non-clause' && row.sub_type && row.sub_type !== 'null' ? row.sub_type : null,
            text: origText || textVal,
            reviewed_text: textVal || origText,
            decision: decision,
          };
          if (row.note && row.note.trim()) {
            itemPayload.note = row.note.trim();
          } else if (decision === 'rejected') {
            itemPayload.note = 'Rejected during review';
          }
          return itemPayload;
        });

      if (!runId) {
        throw new Error('classification_run_id not found for this document.');
      }
      if (validItems.length === 0) {
        throw new Error('No valid classification items found to save.');
      }

      const saveResult = await documentService.saveClassification(targetDocId, {
        classification_run_id: runId,
        items: validItems,
      });

      if (saveResult?.summary) {
        setClassificationSummary(saveResult.summary);
      }

      // Immediately mark the saved items as reviewed in local state so UI updates without flicker
      const savedIds = new Set(validItems.map((v) => String(v.classification_id)));
      setExtractedClauses((prev) =>
        prev.map((row) => {
          const cid = String(row.classification_id || row.id);
          if (savedIds.has(cid)) {
            const dec = row.decision === 'rejected' ? 'rejected' : (row.isLocallyEdited || row.is_text_modified ? 'corrected' : 'accepted');
            return {
              ...row,
              needs_review: false,
              needsReview: false,
              isReviewed: true,
              isLocallyEdited: false,
              is_text_modified: false,
              outcome: 'reviewed',
              deviated: false,
              review_reasons: [],
              decision: dec,
              review: {
                decision: dec,
                reviewed_by_name: currentUserName,
                reviewed_at: new Date().toISOString(),
              },
            };
          }
          return row;
        })
      );
      setSelectedRows([]);
      setHasUnsavedChanges(false);

      // Re-fetch fresh classification from database to get the updated data immediately
      let freshRows = [];
      const freshClass = await documentService.classification(targetDocId).catch(() => null);
      if (freshClass && Array.isArray(freshClass.items) && freshClass.items.length > 0) {
        freshRows = freshClass.items.map((item, i) => mapClassificationItem(item, i, doc, freshClass));
        setExtractedClauses(freshRows);
        if (Array.isArray(freshClass.deleted_items)) {
          setDeletedClauses(freshClass.deleted_items.map((item, i) => mapClassificationItem(item, i, doc, freshClass)));
        }
        setSelectedRows([]);
        if (freshClass.summary) {
          setClassificationSummary(freshClass.summary);
        }
        if (freshClass.document) {
          setDocumentMeta(freshClass.document);
        }
      }

      const backendStatus = saveResult?.review_status || freshClass?.document?.review_status || 'in_progress';
      const nowFormatted = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setLastSavedTimestamp(nowFormatted);
      const displayStatus = 'Saved';
      setDocumentStatus(displayStatus);

      const finalClauses = freshRows.length > 0 ? freshRows : extractedClauses;
      const remainingNeedsReview =
        freshClass?.summary?.needs_review !== undefined
          ? freshClass.summary.needs_review
          : finalClauses.filter(
              (r) => !r.isReviewed && !r.review?.decision && (r.needs_review || r.needsReview)
            ).length;

      const liveNeedsReviewCount = (freshDocRow?.stages?.classification?.needs_review !== undefined && freshDocRow?.stages?.classification?.needs_review !== null)
        ? freshDocRow.stages.classification.needs_review
        : remainingNeedsReview;

      const updatedDoc = {
        ...doc,
        ...(freshDocRow || {}),
        status: displayStatus,
        review_status: backendStatus,
        needsReview: remainingNeedsReview,
        needs_review: remainingNeedsReview,
        lastSaved: 'Today',
        modifiedTime: nowFormatted,
        isSaved: true,
      };

      if (onUpdateDocument) {
        onUpdateDocument(updatedDoc);
      }

      window.dispatchEvent(
        new CustomEvent('document_saved', {
          detail: { documentId: targetDocId, status: displayStatus, doc: updatedDoc },
        })
      );

      const savedCount = saveResult?.saved
        ? (saveResult.saved.accepted + saveResult.saved.corrected + saveResult.saved.rejected + saveResult.saved.unchanged)
        : validItems.length;

      // Update sessionStorage cache
      try {
        const currentClauses = freshRows.length > 0 ? freshRows : extractedClauses;
        sessionStorage.setItem('accordor_class_cache_' + targetDocId, JSON.stringify({
          items: currentClauses.map((c) => ({
            classification_id: c.classification_id,
            clause_id: c.clause_id,
            number: c.number,
            breadcrumb: c.breadcrumb,
            text: c.reviewed_text || c.text,
            reviewed_text: c.reviewed_text || c.text,
            label: c.label,
            type: c.type,
            type_name: c.type_name,
            sub_type: c.sub_type,
            needs_review: c.needs_review,
            review: c.review,
          })),
          deleted_items: deletedClauses,
          summary: classificationSummary,
          document: documentMeta,
          classification_run: { classification_run_id: runId },
        }));
      } catch (_) {}

      showToast?.(`Saved ${savedCount} clause decisions to database. Updated data loaded!`, 'success');
    } catch (err) {
      console.error('Error saving classification:', err);
      if (err.status === 409) {
        showToast?.('Document was re-classified on backend. Please reload the document.', 'error');
      } else {
        const specificErrors = Array.isArray(err.data?.errors)
          ? err.data.errors.map((e) => e.detail).filter(Boolean).join('; ')
          : '';
        const baseDetail = err.data?.detail || err.message || 'Could not save to database.';
        const problem = specificErrors ? `${baseDetail}: ${specificErrors}` : baseDetail;
        showToast?.(`Save error: ${problem}`, 'error');
      }
    } finally {
      setIsSavingClassification(false);
    }
  };

  const handleOpenDeleteModal = (targetClauses) => {
    const list = Array.isArray(targetClauses) ? targetClauses : (targetClauses ? [targetClauses] : []);
    if (list.length === 0) return;
    setDeleteModalState({
      open: true,
      clause: list[0] || null,
      clauses: list,
      mergeIntoNext: false,
      note: '',
      isDeleting: false,
    });
  };

  const handleConfirmDelete = async () => {
    const targetDocId = doc?.documentId || doc?.id || docId;
    if (!targetDocId) return;

    let runId = classificationRunId;
    if (!runId) {
      const classInfo = await documentService.classification(targetDocId).catch(() => null);
      runId =
        classInfo?.classification_run?.classification_run_id ||
        classInfo?.classification_run?.id ||
        classInfo?.classification_run_id ||
        classInfo?.summary?.classification_run_id;
      if (runId) setClassificationRunId(runId);
    }

    setDeleteModalState((prev) => ({ ...prev, isDeleting: true }));

    try {
      const toDelete = deleteModalState.clauses;
      let lastRes = null;
      const deletedIds = new Set();
      const updatedItemsMap = new Map();

      for (const item of toDelete) {
        const classId = item.classification_id || item.id;
        if (!classId) continue;
        const res = await documentService.deleteClassificationItem(targetDocId, classId, {
          classification_run_id: runId,
          merge_into_next: deleteModalState.mergeIntoNext,
          note: deleteModalState.note || undefined,
        });
        lastRes = res;
        deletedIds.add(String(classId));
        deletedIds.add(String(item.clause_id));
        deletedIds.add(String(item.id));

        if (res?.items && Array.isArray(res.items)) {
          res.items.forEach((it) => {
            updatedItemsMap.set(String(it.classification_id), it);
          });
        }
      }

      // 1. Remove deleted from extractedClauses and update any merged next item
      setExtractedClauses((prev) =>
        prev
          .filter(
            (c) =>
              !deletedIds.has(String(c.classification_id)) &&
              !deletedIds.has(String(c.id)) &&
              !deletedIds.has(String(c.clause_id))
          )
          .map((c) => {
            const updated = updatedItemsMap.get(String(c.classification_id));
            if (updated) {
              return {
                ...c,
                text: updated.text || updated.chunk_text || c.text,
                reviewed_text: updated.reviewed_text || updated.text || c.reviewed_text,
                label: updated.label || c.label,
                type: updated.type || c.type,
                type_name: updated.type_name || c.type_name,
              };
            }
            return c;
          })
      );

      // 2. Update deletedClauses
      if (lastRes?.deleted_items && Array.isArray(lastRes.deleted_items)) {
        setDeletedClauses(lastRes.deleted_items.map((it, i) => mapClassificationItem(it, i, doc, lastRes)));
      } else {
        const newlyDeleted = toDelete.map((it) => ({
          ...it,
          merged_into: deleteModalState.mergeIntoNext ? { note: deleteModalState.note } : null,
          deleted_at: new Date().toISOString(),
        }));
        setDeletedClauses((prev) => [...newlyDeleted, ...prev]);
      }

      // 3. Clear selected rows that were deleted
      setSelectedRows((prev) => prev.filter((k) => !deletedIds.has(String(k))));

      // Update sessionStorage cache
      try {
        const cacheKey = 'accordor_class_cache_' + targetDocId;
        const currentCached = sessionStorage.getItem(cacheKey);
        if (currentCached) {
          const parsed = JSON.parse(currentCached);
          parsed.items = (parsed.items || []).filter(
            (c) =>
              !deletedIds.has(String(c.classification_id)) &&
              !deletedIds.has(String(c.id)) &&
              !deletedIds.has(String(c.clause_id))
          );
          if (lastRes?.deleted_items) {
            parsed.deleted_items = lastRes.deleted_items;
          }
          sessionStorage.setItem(cacheKey, JSON.stringify(parsed));
        }
      } catch (_) {}

      const count = toDelete.length;
      const clauseName = toDelete[0]?.clause_id || '';
      setDeleteModalState({ open: false, clause: null, clauses: [], mergeIntoNext: false, note: '', isDeleting: false });
      showToast?.(
        count > 1 ? `Deleted ${count} clauses.` : `Clause ${clauseName} deleted successfully.`,
        'success'
      );
    } catch (err) {
      console.error('Delete clause error:', err);
      showToast?.(err?.data?.detail || err?.message || err?.detail || 'Failed to delete clause', 'error');
      setDeleteModalState((prev) => ({ ...prev, isDeleting: false }));
    }
  };

  const handleRestoreClause = async (clauseOrList) => {
    const list = Array.isArray(clauseOrList) ? clauseOrList : (clauseOrList ? [clauseOrList] : []);
    if (list.length === 0) return;

    const targetDocId = doc?.documentId || doc?.id || docId;
    if (!targetDocId) return;

    let runId = classificationRunId;
    if (!runId) {
      const classInfo = await documentService.classification(targetDocId).catch(() => null);
      runId =
        classInfo?.classification_run?.classification_run_id ||
        classInfo?.classification_run?.id ||
        classInfo?.classification_run_id ||
        classInfo?.summary?.classification_run_id;
      if (runId) setClassificationRunId(runId);
    }

    try {
      const restoredItems = [];
      const restoredIds = new Set();
      const updatedItemsMap = new Map();
      let lastRes = null;
      let hasKeptMergedText = false;
      let hasUnmergedText = false;

      for (const item of list) {
        const classId = item.classification_id || item.id;
        if (!classId) continue;

        const res = await documentService.restoreClassificationItem(targetDocId, classId, {
          classification_run_id: runId,
        });
        lastRes = res;
        restoredIds.add(String(classId));
        restoredIds.add(String(item.clause_id));

        if (res?.merged_text_kept_in) hasKeptMergedText = true;
        if (res?.unmerged_from) hasUnmergedText = true;

        if (res?.items && Array.isArray(res.items)) {
          res.items.forEach((it) => {
            updatedItemsMap.set(String(it.classification_id), it);
          });
        }

        if (updatedItemsMap.has(String(classId))) {
          restoredItems.push(mapClassificationItem(updatedItemsMap.get(String(classId)), 0, doc, res));
        } else {
          restoredItems.push({ ...item, merged_into: null, deleted_at: null });
        }
      }

      // 1. Update deletedClauses
      if (lastRes?.deleted_items && Array.isArray(lastRes.deleted_items)) {
        setDeletedClauses(lastRes.deleted_items.map((it, i) => mapClassificationItem(it, i, doc, lastRes)));
      } else {
        setDeletedClauses((prev) =>
          prev.filter(
            (c) =>
              !restoredIds.has(String(c.classification_id)) &&
              !restoredIds.has(String(c.id)) &&
              !restoredIds.has(String(c.clause_id))
          )
        );
      }

      // 2. Put restored items back in extractedClauses and unmerge next clause if applicable
      setExtractedClauses((prev) => {
        const updatedPrev = prev.map((c) => {
          const updated = updatedItemsMap.get(String(c.classification_id));
          if (updated && !restoredIds.has(String(c.classification_id))) {
            return {
              ...c,
              text: updated.text || updated.chunk_text || c.text,
              reviewed_text: updated.reviewed_text || updated.text || c.reviewed_text,
            };
          }
          return c;
        });

        const nextList = [...updatedPrev, ...restoredItems];
        nextList.sort((a, b) => {
          const numA = typeof a.number === 'number' ? a.number : parseInt(String(a.clause_id).replace(/\D/g, ''), 10) || 0;
          const numB = typeof b.number === 'number' ? b.number : parseInt(String(b.clause_id).replace(/\D/g, ''), 10) || 0;
          return numA - numB;
        });
        return nextList;
      });

      // Clear from selectedRows if selected
      setSelectedRows((prev) => prev.filter((k) => !restoredIds.has(String(k))));

      // Update sessionStorage cache
      try {
        const cacheKey = 'accordor_class_cache_' + targetDocId;
        const currentCached = sessionStorage.getItem(cacheKey);
        if (currentCached) {
          const parsed = JSON.parse(currentCached);
          if (lastRes?.deleted_items) {
            parsed.deleted_items = lastRes.deleted_items;
          }
          if (lastRes?.items) {
            parsed.items = lastRes.items;
          }
          sessionStorage.setItem(cacheKey, JSON.stringify(parsed));
        }
      } catch (_) {}

      if (hasKeptMergedText) {
        showToast?.(
          `Clause restored. Note: The next clause was edited post-merge, so its text was left untouched. Please review and tidy by hand if needed.`,
          'warning'
        );
      } else if (hasUnmergedText) {
        showToast?.(
          `Clause restored and text unmerged from the next clause.`,
          'success'
        );
      } else {
        showToast?.(
          list.length > 1
            ? `Restored ${list.length} clauses directly to active clauses.`
            : `Clause ${list[0]?.clause_id || ''} restored directly to clauses.`,
          'success'
        );
      }
    } catch (err) {
      console.error('Restore clause error:', err);
      showToast?.(err?.data?.detail || err?.message || err?.detail || 'Failed to restore clause', 'error');
    }
  };

  const totalChunks = classificationSummary?.micro_chunks ?? extractedClauses.length;
  const needsFixCount = needsReviewCount;

  const docName = doc?.name || doc?.fileName || 'Document';
  const docTitle = documentMeta?.title || doc?.title || docName;
  const webViewLink = doc?.webViewLink || documentMeta?.drive_web_link || '';
  const agreementType = doc?.agreement_type || doc?.agreementType || documentMeta?.agreement_type || documentMeta?.agreementType || '';
  const sectorialCategory = doc?.sectorial_category || doc?.sectorial || documentMeta?.sectorial_category || documentMeta?.sectorial || '';

  const getStatusBadgeStyle = (status) => {
    switch (status) {
      case 'Draft':
        return { bgcolor: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' };
      case 'Needs review':
        return { bgcolor: '#f3f4f6', color: '#4b5563', border: '1px solid #e5e7eb' };
      case 'In review':
        return { bgcolor: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' };
      case 'Updated to vector DB':
        return { bgcolor: '#e0e7ff', color: '#3730a3', border: '1px solid #c7d2fe' };
      case 'Reviewed':
        return { bgcolor: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' };
      case 'Saved':
        return { bgcolor: '#f3e8ff', color: '#6b21a8', border: '1px solid #e9d5ff' };
      default:
        return { bgcolor: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' };
    }
  };

  if (!doc) {
    return (
      <Box
        sx={{
          p: 4,
          textAlign: 'center',
          bgcolor: '#ffffff',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <DescriptionOutlinedIcon sx={{ fontSize: 48, color: '#94a3b8', mb: 1.5 }} />
        <Typography variant="h6" sx={{ color: '#1b1f24', fontWeight: 600 }}>
          No document selected
        </Typography>
        <Typography variant="body2" sx={{ color: '#64748b', mt: 0.5, mb: 2.5 }}>
          Select a document from your Google Drive files to view its review workspace.
        </Typography>
        <Button onClick={onBackToDocuments} variant="contained" sx={{ bgcolor: '#1e3a5f', textTransform: 'none' }}>
          Back to Documents
        </Button>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        bgcolor: '#ffffff',
        overflow: 'hidden',
      }}
    >
      {/* 1. TOP HEADER & BREADCRUMBS */}
      <Box
        sx={{
          px: { xs: 2, sm: 3 },
          pt: 1.75,
          pb: 1.5,
          borderBottom: '1px solid #e3e3de',
          bgcolor: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25,
          flexShrink: 0,
        }}
      >
        {/* Breadcrumb Row */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '12px', color: '#7b838c' }}>
          {isSidebarCollapsed && onToggleSidebar && (
            <Tooltip title="Expand sidebar" arrow placement="bottom">
              <IconButton
                size="small"
                onClick={onToggleSidebar}
                sx={{
                  p: 0.4,
                  mr: 0.5,
                  color: '#64748b',
                  borderRadius: 1,
                  '&:hover': { bgcolor: '#f1f5f9', color: '#1e3a5f' },
                }}
              >
                <ChevronRightIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          )}
          <Box
            component="button"
            onClick={onBackToDocuments}
            sx={{
              background: 'none',
              border: 'none',
              p: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              color: '#1e3a5f',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            <ArrowBackIcon sx={{ fontSize: 14 }} />
            Documents
          </Box>
          <span>›</span>
          <span>{doc.folder || 'Google Drive'}</span>
          <span>›</span>
          <Typography sx={{ fontSize: '12px', color: '#1b1f24', fontWeight: 500 }}>{docName}</Typography>
        </Box>

        {/* Title & Actions Row */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 2,
          }}
        >
          {/* Document Title, Status, Agreement Type & Sectorial Category */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
              <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '17px', color: '#1b1f24' }}>
                {docName}
              </Typography>

              {/* Status Badge */}
              <Chip
                label={documentStatus}
                size="small"
                sx={{
                  height: 22,
                  fontSize: '11px',
                  fontWeight: 600,
                  ...getStatusBadgeStyle(documentStatus),
                }}
              />
            </Box>

            {/* Agreement Type and Sectorial Category */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography sx={{ fontSize: '11.5px', color: '#475569', fontWeight: 500 }}>
                <Box component="span" sx={{ color: '#64748b', fontWeight: 400 }}>Agreement: </Box>
                {agreementType || '—'}
              </Typography>
              <Box component="span" sx={{ color: '#cbd5e1' }}>•</Box>
              <Typography sx={{ fontSize: '11.5px', color: '#475569', fontWeight: 500 }}>
                <Box component="span" sx={{ color: '#64748b', fontWeight: 400 }}>Sector: </Box>
                {sectorialCategory || '—'}
              </Typography>
            </Box>
          </Box>

          {/* Action Buttons & Review Counters on Right Side */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            {/* Color-coded Review Stats Counters */}
            <Chip
              label={`${reviewedCount} Reviewed`}
              size="small"
              sx={{
                height: 24,
                fontSize: '11px',
                fontWeight: 600,
                bgcolor: '#dcfce7',
                color: '#15803d',
                border: '1px solid #bbf7d0',
              }}
            />
            <Chip
              label={`${needsReviewCount} Needs review`}
              size="small"
              sx={{
                height: 24,
                fontSize: '11px',
                fontWeight: 600,
                bgcolor: '#fef3c7',
                color: '#b45309',
                border: '1px solid #fde68a',
              }}
            />

            {lastSavedTimestamp && (
              <Typography sx={{ fontSize: '11.5px', color: '#64748b', ml: 0.5, mr: 0.5 }}>
                Saved at {lastSavedTimestamp}
              </Typography>
            )}

            {/* <Button
              variant="outlined"
              size="small"
              startIcon={<UndoOutlinedIcon sx={{ fontSize: 15 }} />}
              onClick={() => showToast?.('Undo action triggered')}
              sx={{
                height: 30,
                fontSize: '12px',
                textTransform: 'none',
                color: '#4a5159',
                borderColor: '#cfcfc8',
                '&:hover': { borderColor: '#1e3a5f', bgcolor: '#f5f5f2' },
              }}
            >
              Undo
            </Button> */}

            <Button
              variant="contained"
              size="small"
              disabled={isSavingClassification}
              startIcon={<SaveOutlinedIcon sx={{ fontSize: 16 }} />}
              onClick={handleSaveClassification}
              sx={{
                height: 30,
                fontSize: '12px',
                textTransform: 'none',
                bgcolor: hasUnsavedChanges ? '#0284c7' : '#1e3a5f',
                color: '#ffffff',
                boxShadow: 'none',
                fontWeight: 600,
                '&:hover': { bgcolor: hasUnsavedChanges ? '#0369a1' : '#152943', boxShadow: 'none' },
              }}
            >
              {isSavingClassification ? 'Saving...' : 'Save'}
            </Button>

            <Tooltip
              title={
                !canEdit
                  ? 'Document is read-only. Editing access required.'
                  : 'Publish verified document data to Vector DB'
              }
              arrow
            >
              <span>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={
                    isPublishingToVectorDb ? (
                      <CircularProgress size={14} sx={{ color: '#ffffff' }} />
                    ) : (
                      <CloudUploadOutlinedIcon sx={{ fontSize: 15 }} />
                    )
                  }
                  disabled={!canEdit || isPublishingToVectorDb}
                  onClick={handlePublishToVectorDb}
                  sx={{
                    height: 30,
                    fontSize: '12px',
                    textTransform: 'none',
                    bgcolor: canEdit ? '#059669' : '#94a3b8',
                    color: '#ffffff',
                    boxShadow: 'none',
                    fontWeight: 600,
                    '&:hover': {
                      bgcolor: canEdit ? '#047857' : '#94a3b8',
                      boxShadow: 'none',
                    },
                    '&.Mui-disabled': {
                      bgcolor: '#e2e8f0',
                      color: '#94a3b8',
                    },
                  }}
                >
                  {isPublishingToVectorDb ? 'Updating...' : 'Update to vector DB'}
                </Button>
              </span>
            </Tooltip>
          </Box>
        </Box>

        {/* Lock / Read-Only Banner */}
        {workspaceLock.status !== 'editing' && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 1,
              px: 1.5,
              py: 1,
              bgcolor: workspaceLock.status === 'available' ? '#f0fdf4' : '#fff7ed',
              border: `1px solid ${workspaceLock.status === 'available' ? '#bbf7d0' : '#fed7aa'}`,
              borderRadius: 1,
              color: '#374151',
              fontSize: '13px',
            }}
          >
            <span>
              {workspaceLock.status === 'available'
                ? `${workspaceLock.closedBy || 'The previous reviewer'} closed this document. It is available now.`
                : workspaceLock.status === 'connecting'
                  ? 'Checking document access…'
                  : workspaceLock.status === 'acquiring'
                    ? 'Requesting editing access…'
                    : workspaceLock.status === 'error'
                      ? 'Document access could not be confirmed. Editing is disabled.'
                      : `Read-only while ${workspaceLock.lockedBy || 'another reviewer'} has the document open.`}
            </span>
            {workspaceLock.status === 'available' && (
              <Button
                size="small"
                variant="contained"
                onClick={handleTakeEditingAccess}
                sx={{
                  bgcolor: '#16a34a',
                  '&:hover': { bgcolor: '#15803d' },
                  fontSize: '12px',
                  textTransform: 'none',
                  fontWeight: 600,
                  boxShadow: 'none',
                }}
              >
                Take editing access
              </Button>
            )}
            {workspaceLock.status === 'read-only' && (
              <Button
                size="small"
                variant="contained"
                disabled={isRequestingAccess}
                onClick={handleRequestEditingAccess}
                sx={{
                  bgcolor: isRequestingAccess ? '#94a3b8' : '#0284c7',
                  '&:hover': { bgcolor: '#0369a1' },
                  fontSize: '12px',
                  textTransform: 'none',
                  fontWeight: 600,
                  boxShadow: 'none',
                }}
              >
                {isRequestingAccess ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                    <CircularProgress size={13} sx={{ color: '#ffffff' }} />
                    <span>Request Sent…</span>
                  </Box>
                ) : (
                  'Request Access'
                )}
              </Button>
            )}
          </Box>
        )}

        {/* Subheader counts row */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 1.5,
            pt: 0.5,
            fontSize: '12px',
            color: '#7b838c',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <span>
              pages: {doc.pages ?? 1} · clauses: {doc.clauses ?? totalChunks} · paragraphs:{' '}
              {doc.paragraphs ?? totalChunks} · {doc.size || 'Document'}
            </span>
            <span>|</span>
            <span>
              Current reviewer <strong style={{ color: '#1b1f24' }}>{currentUserName}</strong>
            </span>
          </Box>
        </Box>
      </Box>

      {/* 2. MAIN TABS (Review, History, Document note) */}
      <Box
        sx={{
          px: { xs: 2, sm: 3 },
          pt: 1,
          pb: 1,
          borderBottom: '1px solid #e3e3de',
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          bgcolor: '#ffffff',
          flexShrink: 0,
        }}
      >
        <Box
          onClick={() => setActiveTab('review')}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            pb: 0.75,
            pt: 0.25,
            borderBottom: activeTab === 'review' ? '2px solid #1e3a5f' : '2px solid transparent',
            color: activeTab === 'review' ? '#1e3a5f' : '#7b838c',
            fontWeight: activeTab === 'review' ? 600 : 500,
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          <CheckCircleOutlinedIcon sx={{ fontSize: 16 }} />
          <span>Review</span>
        </Box>

        <Box
          onClick={() => setActiveTab('history')}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            pb: 0.75,
            pt: 0.25,
            borderBottom: activeTab === 'history' ? '2px solid #1e3a5f' : '2px solid transparent',
            color: activeTab === 'history' ? '#1e3a5f' : '#7b838c',
            fontWeight: activeTab === 'history' ? 600 : 500,
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          <HistoryIcon sx={{ fontSize: 16 }} />
          <span>History</span>
          <Chip
            label={historyEventCount}
            size="small"
            sx={{ height: 18, fontSize: '10.5px', bgcolor: '#f3f4f6', color: '#4b5563' }}
          />
        </Box>

        <Box
          onClick={() => setActiveTab('note')}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            pb: 0.75,
            pt: 0.25,
            borderBottom: activeTab === 'note' ? '2px solid #1e3a5f' : '2px solid transparent',
            color: activeTab === 'note' ? '#1e3a5f' : '#7b838c',
            fontWeight: activeTab === 'note' ? 600 : 500,
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          <NoteAltOutlinedIcon sx={{ fontSize: 16 }} />
          <span>Document note</span>
          {documentNote.trim() && <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#0284c7' }} />}
        </Box>
      </Box>

      {/* 3. REVIEW TAB CONTENT */}
      {activeTab === 'review' && (
        <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden', bgcolor: '#ffffff', position: 'relative' }}>
          {/* Left Contents Drawer */}
          <ContentsSidebar
            isOpen={isContentsOpen}
            onClose={() => setIsContentsOpen(false)}
            contentsTree={contentsTree}
            expandedSections={expandedSections}
            onToggleSection={toggleSection}
            highlightedClauseId={highlightedClauseId}
            onSectionClick={handleSectionClick}
            onClauseClick={handleContentsClauseClick}
          />

          {/* Center: Clause Table */}
          <ClauseTable
            extractedClauses={extractedClauses}
            isLoading={isLoadingClauses}
            canEdit={canEdit}
            docName={docName}
            doc={doc}
            webViewLink={webViewLink}
            selectedRows={selectedRows}
            onSelectAll={handleSelectAll}
            onToggleRow={handleToggleRow}
            highlightedClauseId={highlightedClauseId}
            onHighlightClause={handleHighlightClause}
            previewClause={previewClause}
            isPreviewOpen={isPreviewOpen}
            isContentsOpen={isContentsOpen}
            onToggleContents={handleToggleContents}
            onTogglePreview={() => setIsPreviewOpen((prev) => !prev)}
            onOpenHistory={() => setActiveTab('history')}
            onOpenPreview={handleOpenPreview}
            onUpdateRow={handleUpdateRow}
            availableCanonicalTypes={availableCanonicalTypes}
            showToast={showToast}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            typeFilter={typeFilter}
            onTypeFilterChange={setTypeFilter}
            needsFixCount={needsReviewCount}
            reviewedCount={reviewedCount}
            deletedClauses={deletedClauses}
            onDeleteClause={handleOpenDeleteModal}
            onRestoreClause={handleRestoreClause}
          />

          {/* Right: Document Preview Panel */}
          <DocumentPreviewPanel
            isOpen={isPreviewOpen}
            onClose={() => setIsPreviewOpen(false)}
            docName={docName}
            docTitle={docTitle}
            webViewLink={webViewLink}
            extractedClauses={extractedClauses}
            previewClause={previewClause}
            previewClauseIndex={previewClauseIndex}
            onPrevClause={handlePrevPreviewClause}
            onNextClause={handleNextPreviewClause}
            highlightedClauseId={highlightedClauseId}
            onSelectClause={(item) => {
              const targetId = item.id || item.clause_id || item.paraId;
              setHighlightedClauseId(targetId);
              setPreviewClause(item);
              const tableEl = document.getElementById(`table-clause-row-${targetId}`);
              if (tableEl) tableEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}
            previewContainerRef={previewContainerRef}
          />
        </Box>
      )}

      {/* 4. HISTORY TAB CONTENT */}
      {activeTab === 'history' && (
        <DocumentHistory
          docId={docId}
          docName={docName}
          onReturnToReview={() => setActiveTab('review')}
          onHistoryCountUpdate={setHistoryEventCount}
        />
      )}

      {/* 5. DOCUMENT NOTE TAB CONTENT */}
      {activeTab === 'note' && (
        <Box sx={{ flex: 1, overflowY: 'auto', p: { xs: 2.5, sm: 4 }, bgcolor: '#fafaf8' }}>
          <Box sx={{ maxWidth: 840, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 1.5,
              }}
            >
              <Box>
                <Typography sx={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>Document Note</Typography>
                <Typography sx={{ fontSize: '13px', color: '#64748b', mt: 0.5 }}>
                  Add notes, observations, or review comments for <strong>{docName}</strong>.
                </Typography>
              </Box>
              {noteSavedAt && (
                <Chip
                  size="small"
                  label={`Saved at ${noteSavedAt}`}
                  sx={{ bgcolor: '#dcfce7', color: '#166534', fontWeight: 600, fontSize: '11px' }}
                />
              )}
            </Box>

            <Box
              sx={{
                bgcolor: '#ffffff',
                borderRadius: 2,
                border: '1px solid #e2e8f0',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                p: 2.5,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              <TextField
                multiline
                disabled={!canEdit}
                minRows={10}
                maxRows={24}
                fullWidth
                placeholder="Write your note for this entire document here... (e.g. key clauses needing renegotiation, governing jurisdiction observations, compliance sign-offs)"
                value={documentNote}
                onChange={(e) => setDocumentNote(e.target.value)}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    fontSize: '13.5px',
                    lineHeight: 1.6,
                    color: '#1e293b',
                    bgcolor: '#fafaf8',
                    borderRadius: 1.5,
                    p: 1.75,
                    '& fieldset': { borderColor: '#e2e8f0' },
                    '&:hover fieldset': { borderColor: '#cbd5e1' },
                    '&.Mui-focused fieldset': { borderColor: '#1e3a5f' },
                  },
                }}
              />

              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 1.5,
                  pt: 0.5,
                }}
              >
                <Typography sx={{ fontSize: '12px', color: '#94a3b8' }}>
                  {documentNote.length} characters ·{' '}
                  {documentNote.trim() ? documentNote.trim().split(/\s+/).length : 0} words
                </Typography>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {documentNote && (
                    <Button
                      variant="outlined"
                      size="small"
                      disabled={!canEdit}
                      onClick={() => {
                        setDocumentNote('');
                        showToast?.('Document note cleared');
                      }}
                      sx={{
                        textTransform: 'none',
                        color: '#64748b',
                        borderColor: '#cbd5e1',
                        fontSize: '12.5px',
                        fontWeight: 500,
                        '&:hover': { bgcolor: '#f8fafc', borderColor: '#94a3b8' },
                      }}
                    >
                      Clear
                    </Button>
                  )}
                  <Button
                    variant="contained"
                    size="small"
                    disabled={!canEdit}
                    startIcon={<SaveOutlinedIcon sx={{ fontSize: 16 }} />}
                    onClick={handleSaveDocumentNote}
                    sx={{
                      textTransform: 'none',
                      bgcolor: '#1e3a5f',
                      color: '#ffffff',
                      fontSize: '12.5px',
                      fontWeight: 600,
                      px: 2,
                      py: 0.8,
                      borderRadius: 1.5,
                      boxShadow: 'none',
                      '&:hover': { bgcolor: '#152943', boxShadow: 'none' },
                    }}
                  >
                    Save Note
                  </Button>
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>
      )}

      {/* Delete Clause Confirmation Dialog */}
      <Dialog
        open={deleteModalState.open}
        onClose={() => !deleteModalState.isDeleting && setDeleteModalState((prev) => ({ ...prev, open: false }))}
        maxWidth="sm"
        fullWidth
        slotProps={{
          paper: {
            sx: { borderRadius: 2, p: 1 },
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 600, fontSize: '16px', color: '#0f172a', pb: 1 }}>
          {deleteModalState.clauses.length > 1
            ? `Delete ${deleteModalState.clauses.length} Clauses`
            : `Delete Clause ${deleteModalState.clause?.clause_id || ''}`}
        </DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Typography sx={{ fontSize: '13px', color: '#475569', mb: 2 }}>
            {deleteModalState.clauses.length > 1
              ? `Are you sure you want to delete these ${deleteModalState.clauses.length} clauses? They will be moved to the Deleted filter where they can be restored at any time.`
              : 'Are you sure you want to delete this clause? It will be moved to the Deleted filter where it can be restored at any time.'}
          </Typography>

          {deleteModalState.clause && (
            <Box sx={{ p: 1.5, bgcolor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 1.5, mb: 2 }}>
              <Typography sx={{ fontSize: '12px', fontWeight: 600, color: '#1e293b', mb: 0.5 }}>
                {deleteModalState.clause.clause_id} · {deleteModalState.clause.breadcrumb || 'General'}
              </Typography>
              <Typography
                sx={{
                  fontSize: '12px',
                  color: '#64748b',
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {deleteModalState.clause.text}
              </Typography>
            </Box>
          )}

          {/* <FormControlLabel
            control={
              <Checkbox
                checked={deleteModalState.mergeIntoNext}
                onChange={(e) => setDeleteModalState((prev) => ({ ...prev, mergeIntoNext: e.target.checked }))}
                size="small"
              />
            }
            label={
              <Box>
                <Typography sx={{ fontSize: '13px', fontWeight: 500, color: '#1e293b' }}>
                  Merge text into next clause before deletion
                </Typography>
                <Typography sx={{ fontSize: '11px', color: '#64748b' }}>
                  Prepends this clause's text to the next clause in reading order before deleting.
                </Typography>
              </Box>
            }
            sx={{ alignItems: 'flex-start', mb: 2, ml: 0 }}
          /> */}

          <TextField
            fullWidth
            size="small"
            label="Reason / Note (optional)"
            placeholder="e.g. Lead-in belongs with next clause"
            value={deleteModalState.note}
            onChange={(e) => setDeleteModalState((prev) => ({ ...prev, note: e.target.value }))}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setDeleteModalState((prev) => ({ ...prev, open: false }))}
            disabled={deleteModalState.isDeleting}
            sx={{ textTransform: 'none', color: '#64748b', fontSize: '13px' }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleConfirmDelete}
            disabled={deleteModalState.isDeleting}
            startIcon={
              deleteModalState.isDeleting ? (
                <CircularProgress size={16} sx={{ color: '#ffffff' }} />
              ) : (
                <DeleteOutlinedIcon sx={{ fontSize: 16 }} />
              )
            }
            sx={{ textTransform: 'none', fontWeight: 600, fontSize: '13px', px: 2 }}
          >
            {deleteModalState.isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Handover / Access Request Modal for Active Editor */}
      <Dialog
        open={Boolean(incomingAccessRequest)}
        onClose={handleDeclineAccessRequest}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: { borderRadius: 2, p: 0.5 },
        }}
      >
        <DialogTitle sx={{ fontWeight: 700, fontSize: '16px', color: '#0f172a', pb: 1 }}>
          Editing Access Requested
        </DialogTitle>
        <DialogContent sx={{ pt: 0.5 }}>
          <Typography sx={{ fontSize: '13.5px', color: '#334151', lineHeight: 1.5 }}>
            <strong>{incomingAccessRequest?.requestedBy}</strong> is requesting editing access to this document.
          </Typography>
          <Typography sx={{ fontSize: '12px', color: '#64748b', mt: 1.2 }}>
            {hasUnsavedChanges
              ? 'Your pending unsaved changes will be saved to the database before handing over.'
              : 'Granting access will transfer the edit lock and switch your view to read-only.'}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button
            onClick={handleDeclineAccessRequest}
            variant="outlined"
            size="small"
            sx={{ textTransform: 'none', color: '#64748b', borderColor: '#cbd5e1', fontWeight: 600 }}
          >
            Decline
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={handleGrantAccessToRequester}
            sx={{
              textTransform: 'none',
              bgcolor: '#16a34a',
              '&:hover': { bgcolor: '#15803d' },
              fontWeight: 600,
              boxShadow: 'none',
              px: 2,
            }}
          >
            Grant Access
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
