import React, { useState } from 'react';
import { googleDriveService } from '../services/googleDriveService';

export default function DriveFolderModal({
  isOpen,
  onClose,
  driveState,
  onFolderSelected,
  onFetchFiles,
  onConnectDrive,
}) {
  const [isLoadingPicker, setIsLoadingPicker] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  if (!isOpen) return null;

  const handleOpenGooglePicker = async () => {
    setIsLoadingPicker(true);
    setErrorMessage('');
    try {
      const configRes = await googleDriveService.checkConnectionStatus();
      if (!configRes.isConnected) {
        setErrorMessage('Google Drive not connected yet. Please click "Connect with Google OAuth" first.');
        setIsLoadingPicker(false);
        return;
      }

      const tokenRes = await googleDriveService.getPickerToken();
      await googleDriveService.openPicker({
        apiKey: configRes.config.api_key,
        appId: configRes.config.app_id,
        accessToken: tokenRes.access_token,
        onPicked: async (docs) => {
          if (docs && docs.length > 0) {
            const pickedFolder = docs[0];
            const folderIds = docs.map((d) => d.id);
            const folderName = pickedFolder.name || 'Google Drive Folder';
            onFolderSelected({
              folderIds,
              folderPath: folderName,
            });
            await onFetchFiles(folderIds);
            onClose();
          }
        },
      });
    } catch (err) {
      setErrorMessage(err.message || 'Unable to open Google Drive Picker.');
    } finally {
      setIsLoadingPicker(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Configure Google Drive Ingestion</div>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          {/* Status Section */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'var(--surface-2)', borderRadius: '6px', border: '1px solid var(--rule)' }}>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink)' }}>Drive Authentication</div>
              <div style={{ fontSize: '11.5px', color: 'var(--ink-3)' }}>
                {driveState.isConnected
                  ? `Connected${driveState.user?.email ? ` as ${driveState.user.email}` : ''}`
                  : 'No active Google Drive session'}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {driveState.isConnected ? (
                <span className="sync-status-badge connected">
                  <span className="status-dot"></span>
                  Active
                </span>
              ) : (
                <span className="sync-status-badge disconnected">
                  <span className="status-dot"></span>
                  Not Connected
                </span>
              )}
              <button
                type="button"
                className="connect-drive-btn"
                style={{ padding: '6px 12px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                onClick={onConnectDrive}
              >
                <svg width="13" height="13" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
                </svg>
                {driveState.isConnected ? 'Reconnect' : 'Connect with Google'}
              </button>
            </div>
          </div>

          {errorMessage && (
            <div style={{ padding: '10px 14px', background: '#fce8e6', color: '#c5221f', borderRadius: '6px', fontSize: '12.5px', border: '1px solid #fad2cf', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div>{errorMessage}</div>
              <div>
                <button
                  type="button"
                  className="connect-drive-btn"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 12px' }}
                  onClick={onConnectDrive}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
                  </svg>
                  Connect with Google OAuth
                </button>
              </div>
            </div>
          )}

          {/* Option 1: Native Picker */}
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Option 1: Google Folder Picker</div>
            <p style={{ fontSize: '12px', color: 'var(--ink-3)', marginBottom: '10px' }}>
              Select folders directly from your connected Google Workspace or Shared Drive.
            </p>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button
                type="button"
                className="change-folder-btn"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                onClick={handleOpenGooglePicker}
                disabled={isLoadingPicker}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                {isLoadingPicker ? 'Loading Picker...' : 'Open Google Folder Picker'}
              </button>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
