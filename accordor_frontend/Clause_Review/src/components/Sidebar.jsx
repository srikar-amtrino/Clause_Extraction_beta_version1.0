import React from 'react';

export default function Sidebar({
  activeNav = 'overview',
  onNavSelect,
  _documentCount = 0,
  user,
}) {
  return (
    <aside className="sidebar">
      {/* Brand Header */}
      <div className="sidebar-header">
        <div className="brand-text">
          <span className="brand-name">clausereview</span>
          <span className="brand-subtitle">Review & update</span>
        </div>
      </div>

      {/* Navigation Sections */}
      <div className="sidebar-nav">
        {/* Section: Review */}
        <div className="nav-section">
          <div className="nav-section-title">Review</div>
          <ul className="nav-list">
            <li
              className={`nav-item ${activeNav === 'overview' ? 'active' : ''}`}
              onClick={() => onNavSelect && onNavSelect('overview')}
            >
              <div className="nav-item-content">
                <span className="nav-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    <polyline points="9 22 9 12 15 12 15 22" />
                  </svg>
                </span>
                <span>Overview</span>
              </div>
            </li>

            {/* <li
              className={`nav-item ${activeNav === 'documents' ? 'active' : ''}`}
              onClick={() => onNavSelect && onNavSelect('documents')}
            >
              <div className="nav-item-content">
                <span className="nav-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                </span>
                <span>Documents</span>
              </div>
              <span className="nav-badge">{documentCount}</span>
            </li> */}
          </ul>
        </div>

        {/* Section: Publishing */}
        {/* <div className="nav-section">
          <div className="nav-section-title">Publishing</div>
          <ul className="nav-list">
            <li
              className={`nav-item ${activeNav === 'vector-index' ? 'active' : ''}`}
              onClick={() => onNavSelect && onNavSelect('vector-index')}
            >
              <div className="nav-item-content">
                <span className="nav-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <ellipse cx="12" cy="5" rx="9" ry="3" />
                    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                  </svg>
                </span>
                <span>Vector index</span>
              </div>
            </li>
          </ul>
        </div> */}

        {/* Section: Audit */}
        {/* <div className="nav-section">
          <div className="nav-section-title">Audit</div>
          <ul className="nav-list">
            <li
              className={`nav-item ${activeNav === 'activity-log' ? 'active' : ''}`}
              onClick={() => onNavSelect && onNavSelect('activity-log')}
            >
              <div className="nav-item-content">
                <span className="nav-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                </span>
                <span>Activity log</span>
              </div>
            </li>
          </ul>
        </div> */}

        {/* Section: Reference */}
        {/* <div className="nav-section">
          <div className="nav-section-title">Reference</div>
          <ul className="nav-list">
            <li
              className={`nav-item ${activeNav === 'all-states' ? 'active' : ''}`}
              onClick={() => onNavSelect && onNavSelect('all-states')}
            >
              <div className="nav-item-content">
                <span className="nav-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                </span>
                <span>All states</span>
              </div>
            </li>
          </ul>
        </div> */}
      </div>

      {/* Footer User Info */}
      <div className="sidebar-footer">
        <div className="user-pill">
          <div className="user-avatar">
            {user?.name ? user.name[0].toUpperCase() : 'U'}
          </div>
          <span style={{ fontSize: '12px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.email || 'Legal Reviewer'}
          </span>
        </div>
      </div>
    </aside>
  );
}
