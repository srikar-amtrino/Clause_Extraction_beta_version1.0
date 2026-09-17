import React from 'react';

export default function TopNav({
  title = 'Overview',
  searchQuery = '',
  onSearchChange,
  onCheckDrive,
  isCheckingDrive = false,
}) {
  return (
    <header className="top-nav">
      <div className="top-title">{title}</div>

      <div className="top-actions">

        {/* Search bar */}
        <div className="search-container">
          <span className="search-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            type="text"
            className="search-input"
            placeholder="Search documents by name, party or type"
            value={searchQuery}
            onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
          />
        </div>

        {/* Check Drive Button */}
        <button
          type="button"
          className={`top-btn ${isCheckingDrive ? 'spinning' : ''}`}
          onClick={onCheckDrive}
          disabled={isCheckingDrive}
        >
          <span className={`spin-icon`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </span>
          <span>{isCheckingDrive ? 'Checking Drive...' : 'Check Drive'}</span>
        </button>
      </div>
    </header>
  );
}
