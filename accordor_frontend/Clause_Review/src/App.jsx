import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Box, Snackbar, Alert } from '@mui/material';
import Sidebar from './components/Sidebar';
import TopNav from './components/TopNav';
import Overview from './components/Overview';
import Documents from './components/Documents';
import ReviewWorkspace from './components/ReviewWorkspace';
import ActivityLog from './components/ActivityLog';
import FolderMetadataModal from './components/FolderMetadataModal';
import Login from './components/auth/Login';
import Signup from './components/auth/Signup';
import ProtectedRoute from './components/auth/ProtectedRoute';
import PublicRoute from './components/auth/PublicRoute';
import { useAuth } from './context/AuthContext';
import { googleDriveService } from './services/googleDriveService';
import { documentService } from './services/documentService';

// Normalize document model from backend pipeline API or Google Drive
function normalizeDoc(d, currentUser = null) {
  const extraction = d.stages?.extraction;
  const classification = d.stages?.classification;
  const pages = d.pages ?? extraction?.pages ?? 0;
  const clauses = d.clauses ?? extraction?.clauses ?? 0;
  const paragraphs = d.paragraphs ?? extraction?.paragraphs ?? 0;
  const extractionStatus = d.extractionStatus || d.extraction_status || extraction?.status || 'pending';
  const needsReview = d.needsReview ?? classification?.needs_review ?? null;
  const warnings = d.warnings || extraction?.warnings || [];
  const size = d.size || (pages > 0 ? `${Math.max(12, Math.round(pages * 26.5))} KB` : (d.mime_type?.includes('pdf') ? '1.4 MB' : '24 KB'));

  return {
    id: d.document_id || d.id,
    documentId: d.document_id || d.id,
    name: d.name || 'Untitled Document',
    fileName: d.name || 'document.docx',
    title: d.title || d.name,
    pages,
    clauses,
    paragraphs,
    size,
    extractionStatus,
    needsReview,
    warnings,
    stages: d.stages || {},
    status: d.status || (extractionStatus === 'extracted' ? (needsReview > 0 ? 'Needs review' : 'Reviewed') : extractionStatus === 'extracted_with_warnings' ? 'Needs review' : extractionStatus === 'rejected' ? 'Draft' : 'Needs review'),
    statusTag: d.statusTag || (warnings.length > 0 ? `${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : null),
    vectorDbStatus: d.vectorDbStatus || 'Not sent yet',
    vectorDbDetail: d.vectorDbDetail || '',
    folder: d.folder || d.drive_folder_name || 'Google Drive',
    inDriveSince: d.inDriveSince || (d.last_extracted_at ? new Date(d.last_extracted_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Recently'),
    reviewer: d.reviewer || currentUser?.username || currentUser?.name || (currentUser?.email ? currentUser.email.split('@')[0] : 'User'),
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
      action: extractionStatus === 'extracted' ? 'Pipeline extraction completed' : extractionStatus === 'rejected' ? 'Document rejected by parser' : 'File ready from Google Drive',
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

  // Real Documents fetched from backend pipeline API and Google Drive
  const [fetchedDocuments, setFetchedDocuments] = useState([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);

  // Load real documents only when Google Drive is connected
  useEffect(() => {
    let isMounted = true;
    const loadInitialDocuments = async () => {
      if (!driveState.isConnected) {
        if (isMounted) setFetchedDocuments([]);
        return;
      }

      setIsLoadingDocs(true);
      try {
        const res = await documentService.list({ limit: 100 }).catch(() => null);
        let docs = [];
        if (res && res.documents && res.documents.length > 0) {
          docs = [...res.documents];
        }

        // If backend pipeline documents endpoint returned nothing, check if there are files in Google Drive sync
        if (docs.length === 0) {
          const syncResult = await googleDriveService.sync().catch(() => null);
          if (syncResult && syncResult.folders) {
            syncResult.folders.forEach((f) => {
              (f.files || []).forEach((file) => {
                docs.push({
                  id: file.id,
                  document_id: file.id,
                  name: file.name,
                  folder: f.name || 'Google Drive',
                  size: file.size ? `${Math.round(file.size / 1024)} KB` : '1.2 MB',
                  modifiedTime: file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : 'Today',
                  webViewLink: file.webViewLink,
                  stages: file.stages || {},
                });
              });
            });
          }
        }

        if (isMounted) {
          setFetchedDocuments(docs.map((doc) => normalizeDoc(doc, currentUser)));
        }
      } catch (err) {
        console.warn('Loading documents via backend API failed:', err);
        if (isMounted) {
          setFetchedDocuments([]);
        }
      } finally {
        if (isMounted) {
          setIsLoadingDocs(false);
        }
      }
    };
    loadInitialDocuments();
    return () => {
      isMounted = false;
    };
  }, [driveState.isConnected, currentUser]);

  // Derive review document directly from route docId or selected state
  const currentReviewDoc = React.useMemo(() => {
    if (location.pathname.startsWith('/review/')) {
      const docId = location.pathname.split('/review/')[1];
      if (docId) {
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
  };

  const handleOpenReviewWorkspace = (doc) => {
    const selected = doc || fetchedDocuments[0];
    if (selected) {
      setSelectedReviewDoc(selected);
      navigate(`/review/${selected.id || selected.documentId || 'doc'}`);
    }
  };

  const handleBackToDocuments = () => {
    navigate('/documents');
  };

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

  // Check for login success feedback from sessionStorage or navigation state
  useEffect(() => {
    try {
      const flash = sessionStorage.getItem('clausewright_flash_login');
      if (flash) {
        sessionStorage.removeItem('clausewright_flash_login');
        showToast(flash, 'success');
        return;
      }
    } catch {
      /* ignore */
    }

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
          setDriveState((prev) => ({
            ...prev,
            isConnected: true,
            folderPath: res.config?.folderPath || res.config?.folder_path || '',
            folderIds: res.config?.folderIds || res.config?.folder_ids || [],
            agreementType: res.config?.agreementType || res.config?.agreement_type || '',
            sectorial: res.config?.sectorial || '',
            lastChecked: res.config?.lastChecked || 'just now',
            user: res.config?.user || { email: currentUser?.email || 'Google Account' },
          }));
        } else {
          setDriveState((prev) => ({
            ...prev,
            isConnected: false,
            folderPath: '',
            folderIds: [],
            agreementType: '',
            sectorial: '',
            lastChecked: null,
            user: null,
          }));
        }
      } catch (err) {
        console.warn('Initial session check:', err);
      }
    };
    verifyAuthStatus();
  }, [currentUser]);

  // Stats derived from fetched documents
  const stats = {
    needsReview: fetchedDocuments.filter((d) => (d.needsReview > 0) || d.status === 'Needs review').length,
    inReview: fetchedDocuments.filter((d) => d.status === 'In review').length,
    draft: fetchedDocuments.filter((d) => d.status === 'Draft' || d.extractionStatus === 'rejected').length,
    reviewed: fetchedDocuments.filter((d) => d.status === 'Reviewed' || (d.extractionStatus === 'extracted' && d.needsReview === 0)).length,
    updatedToVector: fetchedDocuments.filter((d) => d.vectorDbStatus && d.vectorDbStatus.startsWith('Updated')).length,
  };

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
      setDriveState((prev) => ({
        ...prev,
        isConnected: true,
        folderPath: folder.name,
        folderIds: [folder.id],
        agreementType: agreementType,
        sectorial: sectorial,
        isSyncing: true,
        lastChecked: 'just now',
      }));

      // Fetch files from Google Drive
      const data = await googleDriveService.fetchFiles([folder.id]);

      const docs = [];
      if (data && data.folders) {
        data.folders.forEach((f) => {
          (f.files || []).forEach((file) => {
            docs.push({
              id: file.id,
              name: file.name,
              folder: f.name || folder.name,
              agreementType: agreementType,
              sectorial: sectorial,
              status: 'Needs review',
              size: file.size ? `${Math.round(file.size / 1024)} KB` : '1.2 MB',
              modifiedTime: file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : 'Today',
              webViewLink: file.webViewLink,
            });
          });
        });
      }

      setFetchedDocuments(docs);
      setIsConfigModalOpen(false);
      setSelectedFolderForConfig(null);
      showToast(`Saved folder "${folder.name}". Retrieved ${docs.length} files.`);
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
      let docs = [];
      if (pipelineRes && pipelineRes.documents && pipelineRes.documents.length > 0) {
        docs = [...pipelineRes.documents];
      }

      // Also attempt Google Drive sync if connected
      const syncResult = await googleDriveService.sync().catch(() => null);
      if (syncResult && syncResult.folders) {
        const folderName = syncResult?.folders?.[0]?.name || driveState.folderPath;
        setDriveState((prev) => ({
          ...prev,
          isConnected: true,
          folderPath: folderName,
          lastChecked: 'just now',
        }));

        if (docs.length === 0) {
          syncResult.folders.forEach((f) => {
            (f.files || []).forEach((file) => {
              docs.push({
                id: file.id,
                document_id: file.id,
                name: file.name,
                folder: f.name || folderName,
                size: file.size ? `${Math.round(file.size / 1024)} KB` : '1.2 MB',
                modifiedTime: file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : 'Today',
                webViewLink: file.webViewLink,
                stages: file.stages || {},
              });
            });
          });
        }
      }

      setFetchedDocuments(docs.map((doc) => normalizeDoc(doc, currentUser)));
      showToast(`Synced ${docs.length} documents.`);
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

  const handleViewDocument = (doc) => {
    showToast(`Opening "${doc.name}" for clause review...`);
  };

  // Filter documents by search term if typed
  const filteredDocs = fetchedDocuments.filter((d) =>
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
        documentCount={fetchedDocuments.length}
        user={currentUser || driveState.user}
      />

      {/* Main Content Area */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
        }}
      >
        {isReviewRoute ? (
          <ReviewWorkspace
            document={currentReviewDoc}
            onBackToDocuments={handleBackToDocuments}
            showToast={showToast}
          />
        ) : (
          <>
            <TopNav
              title={activeNav === 'overview' ? 'Overview' : activeNav === 'documents' ? 'Documents' : activeNav === 'activity-log' ? 'Activity Log' : activeNav.replace('-', ' ')}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onCheckDrive={handleCheckDrive}
              isCheckingDrive={driveState.isSyncing}
            />

            {activeNav === 'overview' ? (
              <Overview
                driveState={driveState}
                stats={stats}
                queueItems={[]}
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
                documents={filteredDocs}
                onOpenWorkspace={handleOpenReviewWorkspace}
                onOpenPicker={handleOpenPicker}
                onConnectDrive={handleConnectDrive}
                onCheckDrive={handleCheckDrive}
                onViewDocument={handleViewDocument}
                isEmptyData={fetchedDocuments.length === 0}
              />
            ) : activeNav === 'activity-log' ? (
              <ActivityLog />
            ) : (
              <Overview
                driveState={driveState}
                stats={stats}
                queueItems={[]}
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

      {/* Default redirect: goes to /overview (which redirects to /login if unauthenticated) */}
      <Route path="/" element={<Navigate to="/overview" replace />} />
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  );
}
