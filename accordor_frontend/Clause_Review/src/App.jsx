import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Box, Snackbar, Alert } from '@mui/material';
import Sidebar from './components/Sidebar';
import TopNav from './components/TopNav';
import Overview from './components/Overview';
import Documents from './components/Documents';
import ActivityLog from './components/ActivityLog';
import FolderMetadataModal from './components/FolderMetadataModal';
import Login from './components/auth/Login';
import Signup from './components/auth/Signup';
import ProtectedRoute from './components/auth/ProtectedRoute';
import PublicRoute from './components/auth/PublicRoute';
import { useAuth } from './context/AuthContext';
import { googleDriveService } from './services/googleDriveService';

// Main Authenticated Workspace Layout
function AppWorkspace() {
  const { currentUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Derive active nav directly from route location
  const activeNav = location.pathname.includes('/documents')
    ? 'documents'
    : location.pathname.includes('/activity-log')
    ? 'activity-log'
    : 'overview';

  const [searchQuery, setSearchQuery] = useState('');

  const handleNavSelect = (nav) => {
    if (nav === 'overview') navigate('/overview');
    else if (nav === 'documents') navigate('/documents');
    else if (nav === 'activity-log') navigate('/activity-log');
  };

  // Google Drive connection and sync state
  const [driveState, setDriveState] = useState({
    isConnected: false,
    isSyncing: false,
    folderPath: '',
    folderIds: [],
    agreementType: '',
    sectorial: '',
    lastChecked: '',
    user: null,
  });

  // Documents fetched from Google Drive
  const [fetchedDocuments, setFetchedDocuments] = useState([]);

  // Second modal state (after selecting folder in Google Picker)
  const [selectedFolderForConfig, setSelectedFolderForConfig] = useState(null);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  // Toast alert
  const [toastMessage, setToastMessage] = useState('');

  const showToast = (message) => {
    setToastMessage(message);
  };

  // Check if session is already authenticated on mount / return from OAuth
  useEffect(() => {
    const verifyAuthStatus = async () => {
      try {
        const res = await googleDriveService.checkConnectionStatus();
        if (res.isConnected) {
          setDriveState((prev) => ({
            ...prev,
            isConnected: true,
            user: res.config?.user || { email: currentUser?.email || 'Google Account' },
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
    needsReview: fetchedDocuments.length,
    inReview: 0,
    draft: 0,
    reviewed: 0,
    updatedToVector: 0,
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
    setDriveState((prev) => ({ ...prev, isSyncing: true }));
    showToast('Syncing with Google Drive...');

    try {
      const syncResult = await googleDriveService.sync();

      const syncedDocs = [];
      if (syncResult && syncResult.folders) {
        syncResult.folders.forEach((folder) => {
          (folder.files || []).forEach((file) => {
            syncedDocs.push({
              id: file.id,
              name: file.name,
              folder: folder.name || driveState.folderPath || 'Google Drive',
              agreementType: driveState.agreementType || 'General',
              sectorial: driveState.sectorial || 'Cross-Sector',
              status: 'Needs review',
              size: file.size ? `${Math.round(file.size / 1024)} KB` : '1.2 MB',
              modifiedTime: file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : 'Today',
              webViewLink: file.webViewLink,
            });
          });
        });
      }

      if (syncedDocs.length > 0) {
        setFetchedDocuments(syncedDocs);
      }

      const folderName = syncResult?.folders?.[0]?.name || driveState.folderPath;
      const user = syncResult?.user || driveState.user;
      const added = syncResult?.changes?.added?.length || 0;
      const updated = syncResult?.changes?.updated?.length || 0;

      showToast(`Drive synced: ${syncedDocs.length} files (${added} new, ${updated} updated).`);

      setDriveState((prev) => ({
        ...prev,
        isConnected: true,
        isSyncing: false,
        folderPath: folderName,
        user: user || prev.user,
        lastChecked: 'just now',
      }));
    } catch (err) {
      console.warn('Sync notice:', err.message);
      showToast(`Drive status: ${err.message || 'Please connect Google Drive first.'}`);
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
          severity="info"
          variant="filled"
          sx={{
            bgcolor: '#1e3a5f',
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
