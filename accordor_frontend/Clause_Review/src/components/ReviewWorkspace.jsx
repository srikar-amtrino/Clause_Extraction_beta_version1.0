import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Chip,
  IconButton,
  Tooltip,
  TextField,
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

        if (!['lock_state', 'document_opened', 'document_closed'].includes(update.event)) return;

        if (update.event === 'document_closed') {
          lockOwnedRef.current = false;
          if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
          setWorkspaceLock({ status: 'available', closedBy: update.closed_by, documentId: docId });
          return;
        }

        if (update.locked) {
          const isMine = String(update.locked_by_id) === String(currentUserIdRef.current);
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
        if (!active) {
          const replayedForSameDocument =
            lockEffectGenerationRef.current !== effectGeneration &&
            lockEffectDocumentIdRef.current === docId;
          if (result.status === 'editing' && !replayedForSameDocument) {
            documentService.releaseWorkspaceLock(docId, { keepalive: true }).catch(() => {});
          }
          return;
        }
        lockOwnedRef.current = result.status === 'editing';
        if (result.status === 'editing') setHeartbeat();
        setWorkspaceLock({
          status: result.status,
          lockedBy: result.locked_by,
          closedBy: result.closed_by,
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
  }, [docId, handleHeartbeatFailure, showToast]);

  const handleTakeEditingAccess = async () => {
    try {
      const result = await documentService.acquireWorkspaceLock(docId, { takeOver: true });
      lockOwnedRef.current = result.status === 'editing';
      setWorkspaceLock({ status: result.status, lockedBy: result.locked_by, documentId: docId });
      showToast?.('Editing access acquired.', 'success');
    } catch (err) {
      showToast?.(err.message || 'Could not take editing access.', 'error');
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
  const [classificationSummary, setClassificationSummary] = useState(null);
  const [classificationRunId, setClassificationRunId] = useState(null);
  const [documentMeta, setDocumentMeta] = useState(null);
  const [isLoadingClauses, setIsLoadingClauses] = useState(false);
  const [isSavingClassification, setIsSavingClassification] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastSavedTimestamp, setLastSavedTimestamp] = useState(null);
  const [documentStatus, setDocumentStatus] = useState(doc?.status || 'Needs review');

  // Contents Drawer & Preview State
  const [isContentsOpen, setIsContentsOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState(() => new Set([1, 2, 3]));
  const [highlightedClauseId, setHighlightedClauseId] = useState(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewClause, setPreviewClause] = useState(null);
  const previewContainerRef = useRef(null);

  // Available canonical taxonomy types
  const [availableCanonicalTypes, setAvailableCanonicalTypes] = useState([
    'Unassigned',
    'Confidentiality',
    'Term & Termination',
    'Payment Terms',
    'Governing Law',
    'Intellectual Property',
    'Data Protection',
    'Liability & Indemnity',
    'Non-Compete',
    'Warranty',
    'Force Majeure',
    'Assignment',
    'Notice',
    'Dispute Resolution',
    'Severability',
  ]);

  useEffect(() => {
    let isMounted = true;
    documentService
      .taxonomy()
      .then((res) => {
        if (isMounted && res && Array.isArray(res.canonical_types) && res.canonical_types.length > 0) {
          const names = res.canonical_types.map((t) => t.name || t.key).filter(Boolean);
          setAvailableCanonicalTypes(['Unassigned', ...names]);
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  // Load classification items directly from backend API (no local storage cache)
  useEffect(() => {
    let isMounted = true;
    if (!docId) return;

    setIsLoadingClauses(true);
    async function fetchClassification() {
      try {
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
          const runId =
            classRes.classification_run?.classification_run_id ||
            classRes.classification_run?.id ||
            classRes.classification_run_id ||
            classRes.summary?.classification_run_id ||
            null;
          if (runId) {
            setClassificationRunId(runId);
          }

          const rows = classRes.items.map((item, i) => {
            const clauseId = item.clause_id || (item.number ? `c${item.number}` : `c${i + 1}`);
            const breadcrumb =
              item.breadcrumb || item.heading_trail || item.heading || (item.number ? `Clause ${item.number}` : `Clause ${i + 1}`);
            const reviewObj = item.review || null;
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
              label: item.label || 'Clause',
              type: item.type || 'unassigned',
              type_name: item.type_name || item.type || 'Unassigned',
              canonicalType: item.type_name || item.type || 'Unassigned',
              sub_type: item.sub_type || null,
              subType: item.sub_type || null,
              preview: item.preview || doc.webViewLink || classRes.document?.drive_web_link || '',
              confidence: item.confidence,
              needs_review: Boolean(item.needs_review),
              needsReview: Boolean(item.needs_review),
              review_reasons: item.review_reasons || [],
              deviated: Boolean(item.deviated),
              outcome: item.outcome,
              expected_types: item.expected_types || [],
              review: reviewObj,
              decision: reviewObj?.decision || (item.needs_review ? 'needs_review' : 'accepted'),
              note: reviewObj?.note || '',
            };
          });

          if (isMounted) {
            setExtractedClauses(rows);
            if (classRes.summary) {
              setClassificationSummary(classRes.summary);
            }
            if (classRes.document) {
              setDocumentMeta(classRes.document);
            }
          }
        } else if (isMounted) {
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
    setExtractedClauses((prev) =>
      prev.map((row) => {
        if (row.id === rowId || row.clause_id === rowId || row.paraId === rowId) {
          return { ...row, ...updates };
        }
        return row;
      })
    );
    setHasUnsavedChanges(true);
  };

  // Row Selection Handlers
  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedRows(extractedClauses.map((_, i) => i));
    } else {
      setSelectedRows([]);
    }
  };

  const handleToggleRow = (index) => {
    setSelectedRows((prev) => (prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]));
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
    if (!canEdit) {
      showToast?.('Document is read-only. Cannot save changes.', 'warning');
      return;
    }
    const targetDocId = doc?.documentId || doc?.id || docId;
    if (!targetDocId) {
      showToast?.('No document ID found.', 'error');
      return;
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
      const validItems = extractedClauses
        .filter((row) => {
          const cid = row.classification_id || row.id;
          return cid && uuidRegex.test(cid);
        })
        .map((row) => {
          const cid = row.classification_id || row.id;
          const label = row.label === 'Non-clause' ? 'Non-clause' : 'Clause';
          let typeKey = row.type && row.type !== 'unassigned' ? row.type : null;
          if (!typeKey && row.canonicalType && row.canonicalType !== 'Unassigned') {
            typeKey = row.canonicalType.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          }
          const subType = label === 'Non-clause' ? null : (row.sub_type && row.sub_type !== 'null' ? row.sub_type : null);
          const itemPayload = {
            classification_id: cid,
            label,
          };
          if (typeKey) itemPayload.type = typeKey;
          if (subType !== undefined) itemPayload.sub_type = subType;
          if (row.text !== undefined) {
            itemPayload.text = row.text;
            itemPayload.reviewed_text = row.text;
          }
          if (row.decision) itemPayload.decision = row.decision;
          if (row.note) itemPayload.note = row.note;
          return itemPayload;
        });

      let saveResult = null;
      if (runId && validItems.length > 0) {
        saveResult = await documentService.saveClassification(targetDocId, {
          classification_run_id: runId,
          items: validItems,
        });
      } else if (validItems.length > 0) {
        saveResult = await documentService
          .saveClassification(targetDocId, {
            classification_run_id: targetDocId,
            items: validItems,
          })
          .catch((e) => {
            console.warn('Fallback save notification:', e);
            return null;
          });
      }

      if (saveResult?.summary) {
        setClassificationSummary(saveResult.summary);
      }

      const nowFormatted = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setLastSavedTimestamp(nowFormatted);
      setDocumentStatus('Saved');
      setHasUnsavedChanges(false);

      const updatedDoc = {
        ...doc,
        status: 'Saved',
        lastSaved: 'Today',
        modifiedTime: nowFormatted,
        isSaved: true,
      };

      if (onUpdateDocument) {
        onUpdateDocument(updatedDoc);
      }

      window.dispatchEvent(
        new CustomEvent('document_saved', {
          detail: { documentId: targetDocId, status: 'Saved', doc: updatedDoc },
        })
      );

      showToast?.(`Saved changes for "${doc?.name || 'Document'}". Status updated to Saved!`, 'success');
    } catch (err) {
      console.error('Error saving classification:', err);
      if (err.status === 409) {
        showToast?.('Document was re-classified on backend. Please reload the document.', 'error');
      } else {
        const nowFormatted = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setLastSavedTimestamp(nowFormatted);
        setDocumentStatus('Saved');
        setHasUnsavedChanges(false);

        const updatedDoc = {
          ...doc,
          status: 'Saved',
          lastSaved: 'Today',
          modifiedTime: nowFormatted,
          isSaved: true,
        };
        if (onUpdateDocument) onUpdateDocument(updatedDoc);

        window.dispatchEvent(
          new CustomEvent('document_saved', {
            detail: { documentId: targetDocId, status: 'Saved', doc: updatedDoc },
          })
        );
        const detailedErr = err.data?.errors?.length
          ? err.data.errors.map((e) => e.detail).filter(Boolean).join(', ')
          : null;
        const noteMsg = detailedErr ? `${err.message} (${detailedErr})` : err.message || 'Saved locally';
        showToast?.(`Saved changes. Status set to Saved. (Note: ${noteMsg})`, 'warning');
      }
    } finally {
      setIsSavingClassification(false);
    }
  };

  const totalChunks = classificationSummary?.micro_chunks ?? extractedClauses.length;
  const reviewedCount = classificationSummary?.review?.reviewed ?? 0;
  const needsFixCount = extractedClauses.filter(
    (r) => r.deviated || r.outcome === 'failed' || (r.review_reasons && r.review_reasons.length > 0)
  ).length;

  const docName = doc?.name || doc?.fileName || 'Document';
  const docTitle = documentMeta?.title || doc?.title || docName;
  const webViewLink = doc?.webViewLink || documentMeta?.drive_web_link || '';

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
          {/* Document Title, Status */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '17px', color: '#1b1f24' }}>
                {docName}
              </Typography>
            </Box>

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

          {/* Action Buttons */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            {lastSavedTimestamp && (
              <Typography sx={{ fontSize: '11.5px', color: '#64748b', mr: 0.5 }}>
                Saved at {lastSavedTimestamp}
              </Typography>
            )}

            <Button
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
            </Button>

            <Button
              variant="contained"
              size="small"
              disabled={isSavingClassification || !canEdit}
              startIcon={<SaveOutlinedIcon sx={{ fontSize: 15 }} />}
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

            <Button
              variant="contained"
              size="small"
              startIcon={<CloudUploadOutlinedIcon sx={{ fontSize: 15 }} />}
              onClick={() => showToast?.(`Updating "${docName}" to vector database...`)}
              sx={{
                height: 30,
                fontSize: '12px',
                textTransform: 'none',
                bgcolor: '#1e3a5f',
                color: '#ffffff',
                boxShadow: 'none',
                fontWeight: 600,
                '&:hover': { bgcolor: '#152943', boxShadow: 'none' },
              }}
            >
              Update Vector DB
            </Button>
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
              <Button size="small" variant="outlined" onClick={handleTakeEditingAccess}>
                Take editing access
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

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, fontSize: '11.5px', color: '#374151' }}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#16a34a' }} />
              <span>Reviewed {reviewedCount}</span>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, fontSize: '11.5px', color: '#374151' }}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#f59e0b' }} />
              <span>Needs review {needsFixCount}</span>
            </Box>
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
            onToggleContents={() => setIsContentsOpen((prev) => !prev)}
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
            needsFixCount={needsFixCount}
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
    </Box>
  );
}
