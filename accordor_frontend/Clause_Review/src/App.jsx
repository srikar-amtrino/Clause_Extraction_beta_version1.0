import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import TopNav from './components/TopNav';
import Overview from './components/Overview';
import FolderMetadataModal from './components/FolderMetadataModal';
import { googleDriveService } from './services/googleDriveService';
import './styles/clausewright.css';

function App() {
  // Navigation & View state
  const [activeNav, setActiveNav] = useState('overview');
  const [searchQuery, setSearchQuery] = useState('');

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
    setTimeout(() => {
      setToastMessage('');
    }, 4500);
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
            user: res.config?.user || { email: 'Google Account' },
          }));
        }
      } catch (err) {
        console.warn('Initial session check:', err);
      }
    };
    verifyAuthStatus();
  }, []);

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
            // Open the requested second modal showing selected folder, agreement type & sectorial
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

  // Check Drive / Sync logic using POST http://127.0.0.1:8000/api/google-drive/sync/
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
    <div className="app-container">
      {/* Sidebar Navigation */}
      <Sidebar
        activeNav={activeNav}
        onNavSelect={setActiveNav}
        _documentCount={fetchedDocuments.length}
        user={driveState.user}
      />

      {/* Main Content Area */}
      <div className="main-layout">
        <TopNav
          title={activeNav === 'overview' ? 'Overview' : activeNav.replace('-', ' ')}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onCheckDrive={handleCheckDrive}
          isCheckingDrive={driveState.isSyncing}
        />

        {activeNav === 'overview' ? (
          <Overview
            driveState={driveState}
            stats={stats}
            documents={filteredDocs}
            _activeDraft={null}
            onOpenPicker={handleOpenPicker}
            onConnectDrive={handleConnectDrive}
            onCheckDrive={handleCheckDrive}
            onViewDocument={handleViewDocument}
            isEmptyData={fetchedDocuments.length === 0}
          />
        ) : (
          <div className="content-scroll">
            <div className="overview-header">
              <h1 className="overview-date" style={{ textTransform: 'capitalize' }}>
                {activeNav.replace('-', ' ')}
              </h1>
              <p className="overview-subtitle">
                Section details and management for {activeNav.replace('-', ' ')}.
              </p>
            </div>
            <div className="empty-state-box" style={{ marginTop: '20px' }}>
              <div className="empty-state-title">
                {activeNav.replace('-', ' ')} view is ready
              </div>
              <p className="empty-state-desc">
                Switch back to the Overview section to monitor Google Drive files and review queues.
              </p>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setActiveNav('overview')}
              >
                Go to Overview
              </button>
            </div>
          </div>
        )}
      </div>

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

      {/* Toast Alert */}
      {toastMessage && (
        <div className="toast-msg">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}

export default App;
