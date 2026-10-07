import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Box, Snackbar, Alert, IconButton, Tooltip } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import Sidebar from './components/Sidebar';
import TopNav from './components/TopNav';
import Overview from './components/Overview';
import Documents from './components/Documents';
import ReviewWorkspace from './components/ReviewWorkspace';
import ActivityLog from './components/ActivityLog';
import VectorPlayground from './components/VectorPlayground';
import FolderMetadataModal from './components/FolderMetadataModal';
import ErrorBoundary from './components/ErrorBoundary';
import Login from './components/auth/Login';
import Signup from './components/auth/Signup';
import ProtectedRoute from './components/auth/ProtectedRoute';
import PublicRoute from './components/auth/PublicRoute';
import { useAuth } from './context/AuthContext';
import { googleDriveService } from './services/googleDriveService';
import { documentService } from './services/documentService';

// Deduplicate documents strictly by normalized name so a document NEVER appears twice
function deduplicateDocs(docs) {
  const map = new Map();
  docs.forEach((doc) => {
    const key = (doc.name || doc.fileName || '').trim().toLowerCase();
    if (!key) {
      const fallbackKey = String(doc.documentId || doc.id);
      map.set(fallbackKey, doc);
      return;
    }
    if (!map.has(key)) {
      map.set(key, doc);
    } else {
      const existing = map.get(key);
      const existingStatus = (existing.extraction_status || existing.extractionStatus || '').toLowerCase();
      const newStatus = (doc.extraction_status || doc.extractionStatus || '').toLowerCase();
      const existingClassified = existingStatus === 'classified' || Boolean(existing.stages?.classification || existing.classified || (existing.stages?.classification?.micro_chunks > 0));
      const newClassified = newStatus === 'classified' || Boolean(doc.stages?.classification || doc.classified || (doc.stages?.classification?.micro_chunks > 0));
      if (!existingClassified && newClassified) {
        map.set(key, doc);
      } else if (existingClassified && !newClassified) {
        // Keep existing classified document
      } else {
        const isExistingExtracted = existingStatus === 'extracted' || existingStatus === 'extracted_with_warnings';
        const isNewExtracted = newStatus === 'extracted' || newStatus === 'extracted_with_warnings';
        if (!isExistingExtracted && isNewExtracted) {
          map.set(key, doc);
        } else if (isExistingExtracted === isNewExtracted) {
          const existingPages = existing.pages || 0;
          const newPages = doc.pages || 0;
          if (newPages > existingPages) {
            map.set(key, doc);
          }
        }
      }
    }
  });
  return Array.from(map.values());
}

// Normalize document model from backend pipeline API or Google Drive
function normalizeDoc(d, currentUser = null) {
  const extraction = d.stages?.extraction;
  const classification = d.stages?.classification;
  const pages = d.pages ?? extraction?.pages ?? 0;
  const clauses = d.clauses ?? extraction?.clauses ?? 0;
  const paragraphs = d.paragraphs ?? extraction?.paragraphs ?? 0;

  // Determine if document has reached classified status in API database
  const rawStatus = (
    d.extraction_status ||
    d.extractionStatus ||
    extraction?.status ||
    'pending'
  ).toLowerCase();

  const isClassified =
    rawStatus === 'classified' ||
    (d.status && String(d.status).toLowerCase() === 'classified') ||
    d.classified === true ||
    Boolean(classification && (classification.status === 'succeeded' || (classification.micro_chunks && classification.micro_chunks > 0) || classification.id));

  const isExtracted =
    rawStatus === 'extracted' ||
    rawStatus === 'extracted_with_warnings' ||
    Boolean(extraction && extraction.status === 'succeeded');

  const isRejected =
    rawStatus === 'rejected' ||
    rawStatus === 'failed';

  const extractionStatus = isClassified
    ? 'classified'
    : isExtracted
    ? (rawStatus === 'extracted_with_warnings' ? 'extracted_with_warnings' : 'extracted')
    : isRejected
    ? rawStatus
    : 'pending';

  const needsReview = d.needsReview ?? classification?.needs_review ?? null;
  const warnings = d.warnings || extraction?.warnings || [];
  const size = d.size || (pages > 0 ? `${Math.max(12, Math.round(pages * 26.5))} KB` : (d.mime_type?.includes('pdf') ? '1.4 MB' : '24 KB'));
  const currentReviewer = d.current_reviewer !== undefined
    ? d.current_reviewer
    : (d.rawDoc?.current_reviewer !== undefined ? d.rawDoc.current_reviewer : null);

    const isPublished = Boolean(
      d.isPublished ||
      d.status === 'Published' ||
      d.status === 'Updated to vector DB' ||
      d.review_status === 'published' ||
      (d.vectorDbStatus && (d.vectorDbStatus.startsWith('Updated') || d.vectorDbStatus === 'Published'))
    );
    return {
      id: d.document_id || d.id,
      documentId: d.document_id || d.id,
      name: d.name || 'Untitled Document',
      fileName: d.name || 'document.docx',
      title: d.title || d.name,
      agreement_type: d.agreement_type || d.agreementType || d.metadata?.agreement_type || '',
      sectorial_category: d.sectorial_category || d.sectorial || d.metadata?.sectorial_category || '',
      agreementType: d.agreement_type || d.agreementType || d.metadata?.agreement_type || '',
      sectorial: d.sectorial_category || d.sectorial || d.metadata?.sectorial_category || '',
      pages,
      clauses,
      paragraphs,
      size,
      extraction_status: extractionStatus,
      extractionStatus,
      isClassified,
      needsReview,
      warnings,
      stages: d.stages || {},
      current_reviewer: currentReviewer,
      currentReviewer: currentReviewer,
      status: d.status || (isPublished ? 'Published' : currentReviewer ? 'In review' : (isClassified ? (needsReview > 0 ? 'Needs review' : 'Reviewed') : extractionStatus === 'extracted' ? (needsReview > 0 ? 'Needs review' : 'Reviewed') : extractionStatus === 'rejected' ? 'Draft' : 'Needs review')),
      statusTag: d.statusTag || (warnings.length > 0 ? `${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : null),
      vectorDbStatus: d.vectorDbStatus || (isPublished ? 'Updated to vector DB' : 'Not sent yet'),
      isPublished,
      vectorDbDetail: d.vectorDbDetail || '',
    folder: d.folder || d.drive_folder_name || 'Google Drive',
    inDriveSince: d.inDriveSince || (d.last_extracted_at ? new Date(d.last_extracted_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Recently'),
    reviewer: currentReviewer || d.reviewer || currentUser?.username || currentUser?.name || (currentUser?.email ? currentUser.email.split('@')[0] : 'User'),
    lastSaved: d.lastSaved || (d.last_extracted_at ? new Date(d.last_extracted_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : 'Today'),
    lastExtracted: d.lastExtracted || (d.last_extracted_at ? new Date(d.last_extracted_at).toLocaleString() : null),
    issues: {
      duplicateParaId: 0,
      canonicalTypeMissing: needsReview ?? 0,
      paragraphsToReview: needsReview ?? (paragraphs - clauses > 0 ? paragraphs - clauses : 0),
      warnings,
    },
    recentActivity: {
      user: 'System',
      action: isClassified ? 'Pipeline classification completed' : extractionStatus === 'extracted' ? 'Pipeline extraction completed' : extractionStatus === 'rejected' ? 'Document rejected by parser' : 'File ready from Google Drive',
      timestamp: d.last_extracted_at ? new Date(d.last_extracted_at).toLocaleDateString() : 'Today',
    },
    webViewLink: d.drive_web_link || d.webViewLink,
    rawDoc: d,
  };
}

// Main Authenticated Workspace Layout
function AppWorkspace() {
  const { currentUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const isReviewRoute = location.pathname.includes('/review');

  // Derive active nav directly from route location (keep documents selected on review route)
  const activeNav = isReviewRoute
    ? 'documents'
    : location.pathname.includes('/documents')
    ? 'documents'
    : location.pathname.includes('/activity-log')
    ? 'activity-log'
    : location.pathname.includes('/vector-playground')
    ? 'vector-playground'
    : 'overview';

  const [selectedReviewDoc, setSelectedReviewDoc] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Google Drive connection and sync state
  const [driveState, setDriveState] = useState({
    isConnected: false,
    isSyncing: false,
    folderPath: '',
    folderIds: [],
    agreementType: '',
    sectorial: '',
    lastChecked: null,
    user: null,
  });

  // Real Documents loaded directly from API (cached in sessionStorage for 0ms load on reopen/reload)
  const [fetchedDocuments, setFetchedDocuments] = useState(() => {
    try {
      const cached = sessionStorage.getItem('accordor_cached_documents');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (_) {}
    return [];
  });
  const [_isLoadingDocs, setIsLoadingDocs] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [serverStats, setServerStats] = useState(() => {
    try {
      const cached = sessionStorage.getItem('accordor_stats_v1');
      if (cached) return JSON.parse(cached);
    } catch (_) {}
    return null;
  });

  // Clear legacy cache keys
  useEffect(() => {
    try {
      localStorage.removeItem('clausewright_cached_drivestate');
      localStorage.removeItem('clausewright_cached_documents');
      localStorage.removeItem('accordor_cached_documents_v1');
    } catch (_) {}
  }, []);

  // Fetch /api/documents/stats/ immediately — this is a tiny, fast endpoint.
  // We do it independently of the slow document list so Overview cards are
  // populated within ~100ms of mount rather than waiting for the full list.
  useEffect(() => {
    let cancelled = false;
    const fetchStats = async () => {
      try {
        const res = await documentService.stats().catch(() => null);
        if (!cancelled && res) {
          setServerStats(res);
          try { sessionStorage.setItem('accordor_stats_v1', JSON.stringify(res)); } catch (_) {}
        }
      } catch (_) {}
    };
    fetchStats();
    return () => { cancelled = true; };
  }, []);

  // Load real documents immediately from /api/documents/ and merge with Google Drive if connected
  useEffect(() => {
    let isMounted = true;
    const loadInitialDocuments = async () => {
      try {
        const pipelineRes = await documentService.list({ limit: 100 }).catch(() => null);
        const pipelineDocs = pipelineRes?.documents || [];

        let driveFolders = [];
        if (driveState.isConnected) {
          const syncResult = await googleDriveService.sync().catch(() => null);
          if (syncResult && syncResult.folders) {
            driveFolders = syncResult.folders;
          } else if (driveState.folderIds && driveState.folderIds.length > 0) {
            const fetchRes = await googleDriveService.fetchFiles(driveState.folderIds, {
              agreementType: driveState.agreementType,
              sectorialCategory: driveState.sectorial,
            }).catch(() => null);
            if (fetchRes && fetchRes.folders) driveFolders = fetchRes.folders;
          }
        }

        const mergedDocs = [];
        const seenNames = new Set();

        // 1. Database pipeline documents (source of truth)
        pipelineDocs.forEach((p) => {
          const norm = normalizeDoc(p, currentUser);
          const key = (norm.name || norm.fileName || '').trim().toLowerCase();
          if (key) seenNames.add(key);
          mergedDocs.push(norm);
        });

        // 2. Google Drive files that are not already in the database pipeline
        driveFolders.forEach((f) => {
          (f.files || []).forEach((file) => {
            const nameKey = (file.name || '').trim().toLowerCase();
            if (!seenNames.has(nameKey)) {
              seenNames.add(nameKey);
              mergedDocs.push(normalizeDoc({
                id: file.id,
                document_id: file.id,
                name: file.name,
                folder: f.name || driveState.folderPath || 'Google Drive',
                agreement_type: file.agreement_type || file.agreementType || f.agreement_type || driveState.agreementType || '',
                sectorial_category: file.sectorial_category || file.sectorial || f.sectorial_category || driveState.sectorial || '',
                extraction_status: 'pending',
                extractionStatus: 'pending',
                size: file.size ? `${Math.round(file.size / 1024)} KB` : '24 KB',
                modifiedTime: file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : 'Today',
                webViewLink: file.webViewLink,
              }, currentUser));
            }
          });
        });

        const deduped = deduplicateDocs(mergedDocs);
        if (isMounted && deduped.length > 0) {
          setFetchedDocuments(deduped);
          try {
            sessionStorage.setItem('accordor_cached_documents', JSON.stringify(deduped));
          } catch (_) {}
        }
      } catch (err) {
        console.warn('Initial document fetch notice:', err);
      } finally {
        if (isMounted) setIsLoadingDocs(false);
      }
    };
    loadInitialDocuments();
    return () => {
      isMounted = false;
    };
  }, [driveState.isConnected, driveState.folderPath, currentUser]);

  // Separate queue files (pending, extracted, or rejected) from classified documents based on extraction_status from database
  // Per requirement:
  // - extraction status is pending or extracted -> show in Your Queue section
  // - when extraction status changes to classified (in API database) -> show in Documents section with extraction status: classified
  const queueDocuments = React.useMemo(() => {
    return fetchedDocuments.filter((d) => {
      const status = (d.extraction_status || d.extractionStatus || 'pending').toLowerCase();
      return status !== 'classified';
    });
  }, [fetchedDocuments]);

  const extractedDocuments = React.useMemo(() => {
    return fetchedDocuments.filter((d) => {
      const status = (d.extraction_status || d.extractionStatus || '').toLowerCase();
      return status === 'classified' || d.status === 'Saved' || d.isSaved;
    });
  }, [fetchedDocuments]);

  // Polling: When unclassified files exist in queue, check /api/documents/ every 5 seconds.
  // Once backend classification finishes, the status updates to 'classified' and the file moves to Documents!
  useEffect(() => {
    if (!driveState.isConnected) return;
    const hasUnclassified = queueDocuments.some((d) => {
      const s = (d.extraction_status || d.extractionStatus || 'pending').toLowerCase();
      return s === 'pending' || s === 'extracted' || s === 'extracted_with_warnings';
    });
    if (!hasUnclassified) return;

    const timer = setInterval(async () => {
      try {
        const res = await documentService.list({ limit: 100 }).catch(() => null);
        if (!res || !res.documents || res.documents.length === 0) return;

        setFetchedDocuments((prev) => {
          let hasChange = false;
          const updated = prev.map((doc) => {
            const match = res.documents.find(
              (p) => (p.document_id || p.id) === (doc.documentId || doc.id) || (p.name || '').toLowerCase() === (doc.name || '').toLowerCase()
            );
            if (match) {
              const prevNorm = doc;
              const newNorm = normalizeDoc({ ...doc, ...match }, currentUser);
              if (prevNorm.status === 'Saved') {
                newNorm.status = 'Saved';
                newNorm.isSaved = true;
              }
              if (
                newNorm.extractionStatus !== prevNorm.extractionStatus ||
                newNorm.pages !== prevNorm.pages ||
                newNorm.clauses !== prevNorm.clauses ||
                newNorm.needsReview !== prevNorm.needsReview
              ) {
                hasChange = true;
                return newNorm;
              }
            }
            return doc;
          });
          if (hasChange) {
            const deduped = deduplicateDocs(updated);
            try {
              sessionStorage.setItem('accordor_cached_documents', JSON.stringify(deduped));
            } catch (_) {}
            return deduped;
          }
          return prev;
        });
      } catch {
        /* ignore polling errors */
      }
    }, 5000);

    return () => clearInterval(timer);
  }, [driveState.isConnected, queueDocuments, currentUser]);

  // Derive review document directly from route docId or selected state
  const currentReviewDoc = React.useMemo(() => {
    if (location.pathname.startsWith('/review/')) {
      const docId = location.pathname.split('/review/')[1];
      if (docId) {
        if (selectedReviewDoc && (selectedReviewDoc.id === docId || selectedReviewDoc.documentId === docId)) {
          return selectedReviewDoc;
        }
        const found = fetchedDocuments.find((d) => d.id === docId || d.documentId === docId);
        if (found) return found;
        return { id: docId, documentId: docId, name: 'Loading Document...' };
      }
    }
    return selectedReviewDoc || fetchedDocuments[0] || null;
  }, [location.pathname, selectedReviewDoc, fetchedDocuments]);

  const handleNavSelect = (nav) => {
    if (nav === 'overview') navigate('/overview');
    else if (nav === 'documents') navigate('/documents');
    else if (nav === 'activity-log') navigate('/activity-log');
    else if (nav === 'vector-playground') navigate('/vector-playground');
  };

  const handleOpenReviewWorkspace = (doc) => {
    const selected = doc || fetchedDocuments[0];
    if (selected) {
      setSelectedReviewDoc(selected);
      navigate(`/review/${selected.documentId || selected.id || 'doc'}`);
    }
  };

  const handleBackToDocuments = () => {
    // Refresh document list from backend so table reflects latest live state
    documentService.list({ limit: 100 }).then((res) => {
      if (res && res.documents) {
        setFetchedDocuments((prev) => {
          const updated = prev.map((doc) => {
            const match = res.documents.find(
              (p) => (p.document_id || p.id) === (doc.documentId || doc.id) || (p.name || '').toLowerCase() === (doc.name || '').toLowerCase()
            );
            return match ? normalizeDoc({ ...doc, ...match }, currentUser) : doc;
          });
          return deduplicateDocs(updated);
        });
      }
    }).catch(() => {});
    navigate('/documents');
  };

  const handleUpdateDocument = (updatedDoc) => {
    if (!updatedDoc) return;
    const targetId = updatedDoc.id || updatedDoc.documentId || updatedDoc.document_id;
    const targetName = (updatedDoc.name || updatedDoc.fileName || '').trim().toLowerCase();
    const isPublished = Boolean(
      updatedDoc.isPublished ||
      updatedDoc.status === 'Published' ||
      updatedDoc.status === 'Updated to vector DB' ||
      updatedDoc.review_status === 'published' ||
      (updatedDoc.vectorDbStatus && (updatedDoc.vectorDbStatus.startsWith('Updated') || updatedDoc.vectorDbStatus === 'Published'))
    );

    setSelectedReviewDoc((prev) => (prev && (prev.id === targetId || prev.documentId === targetId) ? { ...prev, ...updatedDoc } : updatedDoc));
    setFetchedDocuments((prev) => {
      let matched = false;
      const updated = prev.map((d) => {
        const matchesId = (d.id && d.id === targetId) || (d.documentId && d.documentId === targetId);
        const matchesName = targetName && (d.name || d.fileName || '').trim().toLowerCase() === targetName;
        if (matchesId || matchesName) {
          matched = true;
          return {
            ...d,
            ...updatedDoc,
            needsReview: updatedDoc.needsReview !== undefined ? updatedDoc.needsReview : (updatedDoc.needs_review !== undefined ? updatedDoc.needs_review : d.needsReview),
            status: updatedDoc.status || (isPublished ? 'Published' : d.status),
            vectorDbStatus: updatedDoc.vectorDbStatus || (isPublished ? 'Updated to vector DB' : d.vectorDbStatus),
            isPublished,
          };
        }
        return d;
      });
      if (!matched) {
        updated.unshift({
          ...updatedDoc,
          status: updatedDoc.status || (isPublished ? 'Published' : 'Needs review'),
          vectorDbStatus: updatedDoc.vectorDbStatus || (isPublished ? 'Updated to vector DB' : 'Not sent yet'),
          isPublished,
        });
      }
      try {
        sessionStorage.setItem('accordor_cached_documents', JSON.stringify(updated));
      } catch (_) {}
      return updated;
    });

    // Refresh Overview stats in the background so the cards reflect the save.
    documentService.stats().then((res) => {
      if (res) {
        setServerStats(res);
        try { sessionStorage.setItem('accordor_stats_v1', JSON.stringify(res)); } catch (_) {}
      }
    }).catch(() => {});
  };

  useEffect(() => {
    const handleDocumentSavedEvent = (event) => {
      if (event?.detail?.doc) {
        handleUpdateDocument(event.detail.doc);
      }
    };
    window.addEventListener('document_saved', handleDocumentSavedEvent);
    return () => window.removeEventListener('document_saved', handleDocumentSavedEvent);
  }, []);

  // Second modal state (after selecting folder in Google Picker)
  const [selectedFolderForConfig, setSelectedFolderForConfig] = useState(null);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  // Toast alert
  const [toastMessage, setToastMessage] = useState('');
  const [toastSeverity, setToastSeverity] = useState('info');

  const showToast = (message, severity = 'info') => {
    setToastMessage(message);
    setToastSeverity(severity);
  };

  // Check for login success feedback from navigation state
  useEffect(() => {
    if (location.state?.loginSuccess) {
      showToast(location.state.message || 'You have logged in successfully!', 'success');
      try {
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch {
        /* ignore */
      }
    }
  }, [location.state]);

  // Check if session is already authenticated on mount / return from OAuth
  useEffect(() => {
    const verifyAuthStatus = async () => {
      try {
        const res = await googleDriveService.checkConnectionStatus();
        if (res && res.isConnected && res.config) {
          const updated = {
            isConnected: true,
            folderPath: res.config?.folderPath || res.config?.folder_path || '',
            folderIds: res.config?.folderIds || res.config?.folder_ids || [],
            agreementType: res.config?.agreementType || res.config?.agreement_type || '',
            sectorial: res.config?.sectorial || res.config?.sectorial_category || '',
            lastChecked: res.config?.lastChecked || 'just now',
            user: res.config?.user || { email: currentUser?.email || 'Google Account' },
          };
          setDriveState((prev) => ({ ...prev, ...updated }));
        } else if (res && res.isConnected === false && !res.isOffline) {
          // Explicitly disconnected
          const disconnected = {
            isConnected: false,
            folderPath: '',
            folderIds: [],
            agreementType: '',
            sectorial: '',
            lastChecked: null,
            user: null,
          };
          setDriveState((prev) => ({ ...prev, ...disconnected }));
        }
      } catch (err) {
        console.warn('Initial session check:', err);
      }
    };
    verifyAuthStatus();
  }, [currentUser]);

  // Stats: use server-side counts when they are available (fast, accurate);
  // fall back to deriving from the fetched document list while it loads.
  const stats = React.useMemo(() => {
    if (serverStats && serverStats.counts) {
      const c = serverStats.counts;
      const reviewed = (c.reviewed || 0) + (c.published || 0) + (c.reopened_reviewed || 0);
      const draft = (c.draft || 0);
      return {
        needsReview: (c.needs_review || 0),
        processing: (c.pending || 0) + (c.pending_classification || 0),
        inReview: (c.in_review || 0) + (c.reopened_in_review || 0),
        draft,
        // Overview reads both .reviewed and .inreviewed — keep both in sync
        reviewed,
        inreviewed: reviewed,
        indraft: draft,
        updatedToVector: (c.published || 0),
      };
    }
    // Fallback to local derivation while document list is loading
    const reviewed = extractedDocuments.filter((d) => d.status === 'Reviewed' || (d.extractionStatus === 'classified' && d.needsReview === 0)).length;
    const draft = queueDocuments.filter((d) => d.extractionStatus === 'rejected').length + extractedDocuments.filter((d) => d.status === 'Draft').length;
    return {
      needsReview: extractedDocuments.filter((d) => (d.needsReview > 0) || d.status === 'Needs review').length,
      processing: queueDocuments.filter((d) => {
        const s = (d.extractionStatus || d.extraction_status || 'pending').toLowerCase();
        return s === 'pending' || s === 'extracted' || s === 'extracted_with_warnings';
      }).length,
      inReview: extractedDocuments.filter((d) => d.status === 'In review' || Boolean(d.current_reviewer)).length,
      draft,
      reviewed,
      // Overview reads both .reviewed and .inreviewed — keep both in sync
      inreviewed: reviewed,
      indraft: draft,
      updatedToVector: extractedDocuments.filter((d) => d.vectorDbStatus && d.vectorDbStatus.startsWith('Updated')).length,
    };
  }, [serverStats, extractedDocuments, queueDocuments]);

  // Manual Google Drive OAuth connect
  const handleConnectDrive = () => {
    showToast('Redirecting to Google Drive OAuth...');
    googleDriveService.connect();
  };

  // Launch Google Folder Picker directly
  const handleOpenPicker = async () => {
    try {
      showToast('Opening Google Drive Folder Picker...');
      const configRes = await googleDriveService.checkConnectionStatus();
      if (!configRes.isConnected) {
        showToast('Google Drive not connected. Please connect with Google OAuth first.');
        return;
      }

      setDriveState((prev) => ({
        ...prev,
        isConnected: true,
        user: configRes.config?.user || prev.user,
      }));

      const tokenRes = await googleDriveService.getPickerToken();
      await googleDriveService.openPicker({
        apiKey: configRes.config.api_key,
        appId: configRes.config.app_id,
        accessToken: tokenRes.access_token,
        onPicked: (docs) => {
          if (docs && docs.length > 0) {
            const pickedFolder = docs[0];
            setSelectedFolderForConfig(pickedFolder);
            setIsConfigModalOpen(true);
          }
        },
      });
    } catch (err) {
      console.error('Picker error:', err);
      showToast(`Picker: ${err.message || 'Unable to open Google Picker'}`);
    }
  };

  // Handle Save in the second modal (Folder + Agreement Type + Sectorial)
  const handleSaveFolderConfig = async ({ folder, agreementType, sectorial }) => {
    setIsSavingConfig(true);
    showToast(`Configuring "${folder.name}" (${agreementType} / ${sectorial})...`);

    try {
      setDriveState((prev) => {
        const next = {
          ...prev,
          isConnected: true,
          folderPath: folder.name,
          folderIds: [folder.id],
          agreementType: agreementType,
          sectorial: sectorial,
          isSyncing: true,
          lastChecked: 'just now',
        };
        return next;
      });

      // Fetch files from Google Drive
      const data = await googleDriveService.fetchFiles([folder.id], {
        agreementType,
        sectorialCategory: sectorial,
      });

      // Check backend pipeline documents
      const pipelineRes = await documentService.list({ limit: 100 }).catch(() => null);
      const pipelineDocs = pipelineRes?.documents || [];

      const mergedDocs = [];
      const seenNames = new Set();

      pipelineDocs.forEach((p) => {
        const norm = normalizeDoc(p, currentUser);
        const key = (norm.name || norm.fileName || '').trim().toLowerCase();
        if (key) seenNames.add(key);
        mergedDocs.push(norm);
      });

      if (data && data.folders) {
        data.folders.forEach((f) => {
          (f.files || []).forEach((file) => {
            const nameKey = (file.name || '').trim().toLowerCase();
            if (!seenNames.has(nameKey)) {
              seenNames.add(nameKey);
              mergedDocs.push(normalizeDoc({
                id: file.id,
                document_id: file.id,
                name: file.name,
                folder: f.name || folder.name,
                agreementType,
                sectorial,
                extraction_status: 'pending',
                extractionStatus: 'pending',
                size: file.size ? `${Math.round(file.size / 1024)} KB` : '24 KB',
                modifiedTime: file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : 'Today',
                webViewLink: file.webViewLink,
              }, currentUser));
            }
          });
        });
      }

      const deduped = deduplicateDocs(mergedDocs);
      setFetchedDocuments(deduped);
      setIsConfigModalOpen(false);
      setSelectedFolderForConfig(null);
      showToast(`Saved folder "${folder.name}". Retrieved ${deduped.length} files.`);
    } catch (err) {
      console.error('Save & Fetch error:', err);
      showToast(`Fetch error: ${err.message}`);
    } finally {
      setIsSavingConfig(false);
      setDriveState((prev) => ({ ...prev, isSyncing: false }));
    }
  };

  // Check Drive / Sync logic
  const handleCheckDrive = async () => {
    if (!driveState.isConnected) {
      showToast('Google Drive not connected. Please connect with Google OAuth first.');
      return;
    }

    setDriveState((prev) => ({ ...prev, isSyncing: true }));
    showToast('Syncing with backend pipeline & Google Drive...');

    try {
      // First try fetching latest pipeline results from backend documents endpoint
      const pipelineRes = await documentService.list({ limit: 100 }).catch(() => null);
      const pipelineDocs = pipelineRes?.documents || [];

      // Also attempt Google Drive sync if connected
      const syncResult = await googleDriveService.sync().catch(() => null);
      let driveFolders = syncResult?.folders || [];

      if (driveFolders.length === 0 && driveState.folderIds && driveState.folderIds.length > 0) {
        const fetchRes = await googleDriveService.fetchFiles(driveState.folderIds, {
          agreementType: driveState.agreementType,
          sectorialCategory: driveState.sectorial,
        }).catch(() => null);
        if (fetchRes && fetchRes.folders) {
          driveFolders = fetchRes.folders;
        }
      }

      const folderName = driveFolders?.[0]?.name || driveState.folderPath;
      if (folderName) {
        setDriveState((prev) => {
          const next = {
            ...prev,
            isConnected: true,
            folderPath: folderName,
            lastChecked: 'just now',
          };
          return next;
        });
      }

      const mergedDocs = [];
      const seenNames = new Set();

      pipelineDocs.forEach((p) => {
        const norm = normalizeDoc(p, currentUser);
        const key = (norm.name || norm.fileName || '').trim().toLowerCase();
        if (key) seenNames.add(key);
        mergedDocs.push(norm);
      });

      driveFolders.forEach((f) => {
        (f.files || []).forEach((file) => {
          const nameKey = (file.name || '').trim().toLowerCase();
          if (!seenNames.has(nameKey)) {
            seenNames.add(nameKey);
            mergedDocs.push(normalizeDoc({
              id: file.id,
              document_id: file.id,
              name: file.name,
              folder: f.name || folderName,
              extraction_status: 'pending',
              extractionStatus: 'pending',
              size: file.size ? `${Math.round(file.size / 1024)} KB` : '24 KB',
              modifiedTime: file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : 'Today',
              webViewLink: file.webViewLink,
            }, currentUser));
          }
        });
      });

      const deduped = deduplicateDocs(mergedDocs);
      setFetchedDocuments(deduped);
      showToast(`Synced ${deduped.length} documents.`);
    } catch (err) {
      console.warn('Sync notice:', err.message);
      showToast(`Sync error: ${err.message}`);
    } finally {
      setDriveState((prev) => ({
        ...prev,
        isSyncing: false,
        lastChecked: 'just now',
      }));
    }
  };


  useEffect(() => {
    const onDocSaved = (e) => {
      if (e.detail?.doc) {
        handleUpdateDocument(e.detail.doc);
      } else if (e.detail?.documentId) {
        const docId = String(e.detail.documentId);
        setFetchedDocuments((prev) => {
          const next = prev.map((d) => {
            const id = String(d.id || d.documentId || d.document_id);
            if (id === docId) {
              const isPub = e.detail.status === 'Updated to vector DB' || e.detail.status === 'Published';
              return {
                ...d,
                status: e.detail.status || d.status,
                ...(isPub ? { vectorDbStatus: 'Updated to vector DB', isPublished: true } : {}),
              };
            }
            return d;
          });
          try {
            sessionStorage.setItem('accordor_cached_documents', JSON.stringify(next));
          } catch (_) {}
          return next;
        });
      }
    };
    window.addEventListener('document_saved', onDocSaved);
    return () => window.removeEventListener('document_saved', onDocSaved);
  }, [handleUpdateDocument]);

  const handleViewDocument = (doc) => {
    showToast(`Opening "${doc.name}" for clause review...`);
  };

  // Filter extracted documents by search term for the Documents section
  const filteredDocs = extractedDocuments.filter((d) =>
    d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (d.folder && d.folder.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <Box
      sx={{
        display: 'flex',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        bgcolor: '#fafaf8',
      }}
    >
      {/* Sidebar Navigation */}
      <Sidebar
        activeNav={activeNav}
        onNavSelect={handleNavSelect}
        documentCount={extractedDocuments.length}
        user={currentUser || driveState.user}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
      />

      {/* Floating Expand Sidebar Arrow Button when Collapsed */}
      {isSidebarCollapsed && (
        <Tooltip title="Expand sidebar" arrow placement="right">
          <IconButton
            onClick={() => setIsSidebarCollapsed(false)}
            sx={{
              position: 'fixed',
              left: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 1300,
              width: 22,
              height: 52,
              bgcolor: '#ffffff',
              border: '1px solid #cbd5e1',
              borderLeft: 'none',
              borderRadius: '0 8px 8px 0',
              boxShadow: '2px 0 8px rgba(0,0,0,0.08)',
              color: '#475569',
              p: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              '&:hover': {
                bgcolor: '#f8fafc',
                color: '#1e3a5f',
                width: 26,
              },
              transition: 'all 0.15s ease',
            }}
          >
            <ChevronRightIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      )}

      {/* Main Content Area */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
          minWidth: 0,
        }}
      >
        {isReviewRoute ? (
          <ErrorBoundary onReset={handleBackToDocuments}>
            <ReviewWorkspace
              document={currentReviewDoc}
              onBackToDocuments={handleBackToDocuments}
              showToast={showToast}
              isSidebarCollapsed={isSidebarCollapsed}
              onToggleSidebar={() => setIsSidebarCollapsed((prev) => !prev)}
              onUpdateDocument={handleUpdateDocument}
            />
          </ErrorBoundary>
        ) : (
          <>
            <TopNav
              title={activeNav === 'overview' ? 'Overview' : activeNav === 'documents' ? 'Documents' : activeNav === 'activity-log' ? 'Activity Log' : activeNav.replace('-', ' ')}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onCheckDrive={handleCheckDrive}
              isCheckingDrive={driveState.isSyncing}
              isSidebarCollapsed={isSidebarCollapsed}
              onToggleSidebar={() => setIsSidebarCollapsed((prev) => !prev)}
            />

            {activeNav === 'overview' ? (
              <Overview
                driveState={driveState}
                stats={stats}
                queueItems={queueDocuments}
                searchQuery={searchQuery}
                onOpenPicker={handleOpenPicker}
                onConnectDrive={handleConnectDrive}
                onCheckDrive={handleCheckDrive}
                onNavigateToDocuments={() => handleNavSelect('documents')}
                onNavigateToActivityLog={() => handleNavSelect('activity-log')}
                isEmptyData={fetchedDocuments.length === 0}
              />
            ) : activeNav === 'documents' ? (
              <Documents
                driveState={driveState}
                documents={extractedDocuments}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onOpenWorkspace={handleOpenReviewWorkspace}
                onOpenPicker={handleOpenPicker}
                onConnectDrive={handleConnectDrive}
                onCheckDrive={handleCheckDrive}
                onViewDocument={handleViewDocument}
                isEmptyData={extractedDocuments.length === 0}
                queueCount={queueDocuments.length}
                onNavigateToOverview={() => handleNavSelect('overview')}
              />
            ) : activeNav === 'activity-log' ? (
              <ActivityLog />
            ) : activeNav === 'vector-playground' ? (
              <VectorPlayground />
            ) : (
              <Overview
                driveState={driveState}
                stats={stats}
                queueItems={queueDocuments}
                searchQuery={searchQuery}
                onOpenPicker={handleOpenPicker}
                onConnectDrive={handleConnectDrive}
                onCheckDrive={handleCheckDrive}
                onNavigateToDocuments={() => handleNavSelect('documents')}
                onNavigateToActivityLog={() => handleNavSelect('activity-log')}
                isEmptyData={fetchedDocuments.length === 0}
              />
            )}
          </>
        )}
      </Box>

      {/* Second Modal: Shows Selected Folder Name + Agreement Type & Sectorial Dropdowns */}
      <FolderMetadataModal
        isOpen={isConfigModalOpen}
        folder={selectedFolderForConfig}
        onClose={() => {
          setIsConfigModalOpen(false);
          setSelectedFolderForConfig(null);
        }}
        onSave={handleSaveFolderConfig}
        isSaving={isSavingConfig}
      />

      {/* Toast Alert using MUI Snackbar */}
      <Snackbar
        open={Boolean(toastMessage)}
        autoHideDuration={4500}
        onClose={() => setToastMessage('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={() => setToastMessage('')}
          severity={toastSeverity}
          variant="filled"
          sx={{
            bgcolor: toastSeverity === 'success' ? '#166534' : '#1e3a5f',
            color: '#ffffff',
            fontSize: '13px',
            borderRadius: 2,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            alignItems: 'center',
          }}
        >
          {toastMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
}

// Root Application with React Router Dom
export default function App() {
  return (
    <Routes>
      {/* Public Auth Routes */}
      <Route
        path="/login"
        element={
          <PublicRoute>
            <Login />
          </PublicRoute>
        }
      />
      <Route
        path="/signup"
        element={
          <PublicRoute>
            <Signup />
          </PublicRoute>
        }
      />

      {/* Protected Main Workspace Route */}
      <Route
        path="/overview"
        element={
          <ProtectedRoute>
            <AppWorkspace />
          </ProtectedRoute>
        }
      />
      <Route
        path="/documents"
        element={
          <ProtectedRoute>
            <AppWorkspace />
          </ProtectedRoute>
        }
      />
      <Route
        path="/review"
        element={
          <ProtectedRoute>
            <AppWorkspace />
          </ProtectedRoute>
        }
      />
      <Route
        path="/review/:docId"
        element={
          <ProtectedRoute>
            <AppWorkspace />
          </ProtectedRoute>
        }
      />
      <Route
        path="/activity-log"
        element={
          <ProtectedRoute>
            <AppWorkspace />
          </ProtectedRoute>
        }
      />
      <Route
        path="/vector-playground"
        element={
          <ProtectedRoute>
            <AppWorkspace />
          </ProtectedRoute>
        }
      />

      {/* Default redirect: goes to /overview (which redirects to /login if unauthenticated) */}
      <Route path="/" element={<Navigate to="/overview" replace />} />
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  );
}
