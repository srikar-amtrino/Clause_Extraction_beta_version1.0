import React, { useState } from 'react';

const AGREEMENT_TYPES = [
  'Master Services Agreement (MSA)',
  'Non-Disclosure Agreement (NDA)',
  'Service Level Agreement (SLA)',
  'Statement of Work (SOW)',
  'Employment Agreement',
  'Software License Agreement',
  'Vendor / Supplier Agreement',
  'Commercial Lease Agreement',
  'Data Processing Agreement (DPA)',
  'General Commercial Contract',
];

const SECTORIAL_OPTIONS = [
  'Information Technology & Software',
  'Banking, Financial Services & Insurance (BFSI)',
  'Healthcare & Life Sciences',
  'Legal & Professional Services',
  'Real Estate & Infrastructure',
  'Manufacturing & Supply Chain',
  'Energy, Oil & Utilities',
  'Retail, Consumer Goods & E-Commerce',
  'Telecommunications',
  'Cross-Sector / General',
];

export default function FolderMetadataModal({
  isOpen,
  onClose,
  folder,
  onSave,
  isSaving = false,
}) {
  const [agreementType, setAgreementType] = useState(AGREEMENT_TYPES[0]);
  const [sectorial, setSectorial] = useState(SECTORIAL_OPTIONS[0]);

  if (!isOpen || !folder) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (onSave) {
      onSave({
        folder,
        agreementType,
        sectorial,
      });
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ width: '480px' }}>
        <div className="modal-header">
          <div className="modal-title">Configure Selected Folder</div>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Selected Folder Highlight */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '14px',
              background: 'var(--surface-2)',
              borderRadius: '6px',
              border: '1px solid var(--rule)'
            }}>
              <div style={{
                width: '38px',
                height: '38px',
                borderRadius: '6px',
                background: '#e8f0fe',
                color: '#1a73e8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                </svg>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <span style={{ fontSize: '11px', color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.4px', fontWeight: 600 }}>
                  Selected Google Drive Folder
                </span>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {folder.name || 'Google Drive Folder'}
                </span>
              </div>
            </div>

            {/* Dropdown 1: Agreement Type */}
            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--ink)', marginBottom: '6px' }}>
                Agreement Type <span style={{ color: '#c5221f' }}>*</span>
              </label>
              <select
                className="input-field"
                value={agreementType}
                onChange={(e) => setAgreementType(e.target.value)}
                style={{ cursor: 'pointer', height: '38px' }}
                required
              >
                {AGREEMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            {/* Dropdown 2: Sectorial */}
            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--ink)', marginBottom: '6px' }}>
                Sectorial / Industry Domain <span style={{ color: '#c5221f' }}>*</span>
              </label>
              <select
                className="input-field"
                value={sectorial}
                onChange={(e) => setSectorial(e.target.value)}
                style={{ cursor: 'pointer', height: '38px' }}
                required
              >
                {SECTORIAL_OPTIONS.map((sec) => (
                  <option key={sec} value={sec}>
                    {sec}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={isSaving}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save & Fetch Files'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
