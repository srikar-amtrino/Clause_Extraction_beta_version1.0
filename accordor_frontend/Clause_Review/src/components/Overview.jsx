import React from 'react';

export default function Overview({
  driveState,
  stats,
  documents = [],
  _activeDraft,
  onOpenPicker,
  onConnectDrive,
  onCheckDrive,
  _onResumeReview,
  _onOpenVectorIndex,
  onViewDocument,
  isEmptyData = false,
}) {
  // Format current date matching "Tuesday, 8 September 2026"
  const formattedDate = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  const docsWaitingCount = stats?.needsReview || 0;

  return (
    <div className="content-scroll">
      {/* Date and Summary Header */}
      <div className="overview-header">
        <h1 className="overview-date">{formattedDate}</h1>
        <p className="overview-subtitle">
          {isEmptyData || docsWaitingCount === 0
            ? '0 documents from the Drive folder are waiting on a reviewer.'
            : `${docsWaitingCount} documents from the Drive folder are waiting on a reviewer.`}
        </p>
      </div>

      {/* Google Drive Status Banner */}
      <section className="drive-banner" aria-label="Google Drive Connection Status">
        <div className="drive-left">
          <div className="drive-icon-box" title="Google Drive integration">
            {/* Google Drive icon */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M7.74 3.5L1.5 14.3l3.87 6.7 6.24-10.8-3.87-6.7z" fill="#0066DA" />
              <path d="M16.26 3.5H7.74l6.24 10.8h8.52l-6.24-10.8z" fill="#00AC47" />
              <path d="M22.5 14.3l-3.87-6.7-6.24 10.8h8.52l1.59-4.1z" fill="#EA4335" />
              <path d="M5.37 21h13.26l-3.87-6.7H1.5L5.37 21z" fill="#FFBA00" />
            </svg>
          </div>

          <div className="drive-info">
            <div className="drive-title">
              {driveState.isConnected ? 'Connected to Google Drive' : 'Google Drive'}
            </div>
            <div className="drive-desc">
              {driveState.isConnected ? (
                driveState.folderPath ? (
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                    <span>Watching</span>
                    <span className="folder-path-pill">📁 {driveState.folderPath}</span>
                    {/* {driveState.agreementType && (
                      <span className="pill" style={{ background: '#e8f0fe', color: '#1a73e8', borderColor: '#d2e3fc' }}>
                        {driveState.agreementType}
                      </span>
                    )}
                    {driveState.sectorial && (
                      <span className="pill" style={{ background: '#fef7e0', color: '#b06000', borderColor: '#feefc3' }}>
                        {driveState.sectorial}
                      </span>
                    )} */}
                    <span>— new files appear here automatically.</span>
                    {driveState.lastChecked && <span>Last checked {driveState.lastChecked}.</span>}
                  </div>
                ) : (
                  <>
                    Connected. No folder selected yet. Click "Choose folder" to select a Google Drive folder.
                  </>
                )
              ) : (
                <>
                  Connect your Google Drive account to select folders and fetch contracts for review.
                </>
              )}
            </div>
          </div>
        </div>

        <div className="drive-actions">
          {driveState.isConnected ? (
            <>
              <span className={`sync-status-badge ${driveState.isSyncing ? 'syncing' : 'connected'}`}>
                <span className={`status-dot ${driveState.isSyncing ? 'pulsing' : ''}`}></span>
                {driveState.isSyncing ? 'Syncing' : 'Connected'}
              </span>
              <button
                type="button"
                className="change-folder-btn"
                style={{ fontWeight: 600 }}
                onClick={onOpenPicker}
              >
                {driveState.folderPath ? 'Change folder' : 'Choose folder'}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="connect-drive-btn"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '7px 16px' }}
              onClick={onConnectDrive}
            >
              <svg width="14" height="14" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
              </svg>
              Connect with Google OAuth
            </button>
          )}
        </div>
      </section>

      {/* 5 Status Metric Cards */}
      <section className="metrics-row" aria-label="Review status counters">
        {/* Needs review */}
        <div className="metric-card">
          <div className="metric-header">
            <span className="metric-dot dot-needs-review"></span>
            <span>Needs review</span>
          </div>
          <div className="metric-count">{isEmptyData ? 0 : (stats.needsReview ?? 0)}</div>
          <div className="metric-subtitle">nobody has opened them</div>
        </div>

        {/* In review */}
        <div className="metric-card">
          <div className="metric-header">
            <span className="metric-dot dot-in-review"></span>
            <span>In review</span>
          </div>
          <div className="metric-count">{isEmptyData ? 0 : (stats.inReview ?? 0)}</div>
          <div className="metric-subtitle">someone is working now</div>
        </div>

        {/* Draft */}
        <div className="metric-card">
          <div className="metric-header">
            <span className="metric-dot dot-draft"></span>
            <span>Draft</span>
          </div>
          <div className="metric-count">{isEmptyData ? 0 : (stats.draft ?? 0)}</div>
          <div className="metric-subtitle">unsaved changes waiting</div>
        </div>

        {/* Reviewed */}
        <div className="metric-card">
          <div className="metric-header">
            <span className="metric-dot dot-reviewed"></span>
            <span>Reviewed</span>
          </div>
          <div className="metric-count">{isEmptyData ? 0 : (stats.reviewed ?? 0)}</div>
          <div className="metric-subtitle">ready to send</div>
        </div>

        {/* Updated to vector DB */}
        <div className="metric-card">
          <div className="metric-header">
            <span className="metric-dot dot-vector"></span>
            <span>Updated to vector DB</span>
          </div>
          <div className="metric-count">{isEmptyData ? 0 : (stats.updatedToVector ?? 0)}</div>
          <div className="metric-subtitle">live in retrieval</div>
        </div>
      </section>

      {/* Drive Fetched Documents Table / Queue */}
      <section className="docs-section" aria-label="Google Drive files queue">
        <div className="docs-section-header">
          <div className="docs-section-title">
            <span>Documents from Google Drive</span>
            <span className="docs-count-pill">{isEmptyData ? 0 : documents.length} files</span>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="change-folder-btn"
              style={{ fontSize: '12px', padding: '4px 10px' }}
              onClick={onCheckDrive}
            >
              Sync files
            </button>
          </div>
        </div>

        {isEmptyData || documents.length === 0 ? (
          <div className="empty-state-box">
            <div className="empty-state-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
            </div>
            <div className="empty-state-title">No documents waiting on review</div>
            <div className="empty-state-desc">
              {driveState.isConnected
                ? (driveState.folderPath
                    ? `No new contracts found in "${driveState.folderPath}". Add PDF or DOCX files or click "Sync files".`
                    : 'Select a Google Drive folder to begin reviewing contracts.')
                : 'Connect Google Drive to select folders and fetch contracts for review.'}
            </div>
            <button
              type="button"
              className="btn-primary"
              style={{ marginTop: '6px' }}
              onClick={driveState.isConnected ? onOpenPicker : onConnectDrive}
            >
              {driveState.isConnected
                ? (driveState.folderPath ? 'Change Folder' : 'Choose Folder')
                : 'Connect with Google OAuth'}
            </button>
          </div>
        ) : (
          <table className="files-table">
            <thead>
              <tr>
                <th>Document Name</th>
                <th>Folder</th>
                {/* <th>Agreement Type</th> */}
                {/* <th>Sector</th> */}
                <th>Status</th>
                <th>Size</th>
                <th>Modified</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id || doc.name}>
                  <td className="file-name-cell">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1F4E79" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span>{doc.name}</span>
                  </td>
                  <td style={{ color: 'var(--ink-2)', fontSize: '12px' }}>
                    {doc.folder || driveState.folderPath || 'Drive Folder'}
                  </td>
                  {/* <td>
                    <span className="pill" style={{ fontSize: '11px' }}>
                      {doc.agreementType || driveState.agreementType || 'General'}
                    </span>
                  </td> */}
                  {/* <td>
                    <span className="pill" style={{ fontSize: '11px' }}>
                      {doc.sectorial || driveState.sectorial || 'Cross-Sector'}
                    </span>
                  </td> */}
                  <td>
                    <span className={`file-status-pill status-${(doc.status || 'needs-review').toLowerCase().replace(/\s+/g, '-')}`}>
                      {doc.status || 'Needs review'}
                    </span>
                  </td>
                  <td style={{ color: 'var(--ink-3)', fontSize: '12px' }}>{doc.size || '1.4 MB'}</td>
                  <td style={{ color: 'var(--ink-3)', fontSize: '12px' }}>{doc.modifiedTime || 'Today, 14:20'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="change-folder-btn"
                      style={{ padding: '3px 10px', fontSize: '11.5px' }}
                      onClick={() => onViewDocument && onViewDocument(doc)}
                    >
                      Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
