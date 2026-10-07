import React, { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  Chip,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Checkbox,
  LinearProgress,
  CircularProgress,
  TextField,
  InputAdornment,
  IconButton,
  Menu,
  MenuItem,
  Tooltip,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import CloseIcon from '@mui/icons-material/Close';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import SyncIcon from '@mui/icons-material/Sync';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useAuth } from '../context/AuthContext';
import { documentService } from '../services/documentService';
import { AGREEMENT_TYPES, SECTORIAL_OPTIONS } from './FolderMetadataModal';
import { normalizeDocumentList, computeDocumentCounts } from '../utils/documentUtils';

export default function Documents({
  documents = [],
  onOpenWorkspace,
  driveState = {},
  onOpenPicker,
  onConnectDrive,
  onCheckDrive,
  isEmptyData = false,
  queueCount = 0,
  onNavigateToOverview,
  searchQuery = '',
  onSearchChange,
}) {
  const { currentUser } = useAuth();
  const currentUserName = currentUser?.username || currentUser?.name || (currentUser?.email ? currentUser.email.split('@')[0] : 'Reviewer');
https://github.com/srikar-amtrino/Clause_Extraction_beta_version1.0/pull/42/conflict?name=document_pipeline%252Fservices%252Fexport_service.py&ancestor_oid=801d13530152b225e215dc1f3c280ffb2d092c96&base_oid=b71328dbe5158d8da01d0b1c1188500a46009672&head_oid=edf941ee913404280dfa986f187941dd563144ce
  // Format real documents from backend pipeline API or Google Drive using centralized normalizer
  const allDocs = useMemo(() => {
    if (!documents || documents.length === 0 || isEmptyData) {
      return [];
    }
    return normalizeDocumentList(documents, driveState, currentUserName);
  }, [documents, driveState, isEmptyData, currentUserName]);

  const [activeFilter, setActiveFilter] = useState('all');
  const [localSearch, setLocalSearch] = useState('');
  const activeSearch = searchQuery !== undefined && searchQuery !== '' ? searchQuery : localSearch;

  const handleSearchChange = (val) => {
    setLocalSearch(val);
    if (onSearchChange) {
      onSearchChange(val);
    }
  };
https://github.com/srikar-amtrino/Clause_Extraction_beta_version1.0/pull/42/conflict?name=accordor_frontend%252FClause_Review%252Fsrc%252Fcomponents%252FDocuments.jsx&ancestor_oid=875ba09da17b8cc12714f746ce83a7f885285851&base_oid=4f14f7e640895acc4210a9f591667c8569e43c02&head_oid=2584f7c5a1459c2c47a65db9aa54feebefe2f764
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [selectedAgreementTypes, setSelectedAgreementTypes] = useState([]);
  const [selectedSectorials, setSelectedSectorials] = useState([]);
  const [agreementMenuAnchor, setAgreementMenuAnchor] = useState(null);
  const [sectorialMenuAnchor, setSectorialMenuAnchor] = useState(null);

  // Derive selected document directly from selectedDocId or default to first document
  const selectedDoc = useMemo(() => {
    if (allDocs.length === 0) return null;
    if (selectedDocId) {
      const found = allDocs.find((d) => d.id === selectedDocId || d.documentId === selectedDocId);
      if (found) return found;
    }
    return allDocs[0];
  }, [allDocs, selectedDocId]);

  // Counts for tabs - computed via shared utility
  const counts = useMemo(() => {
    return computeDocumentCounts(allDocs);
  }, [allDocs]);

  // Filtered documents
  const filteredDocs = useMemo(() => {
    return allDocs.filter((d) => {
      // Tab filter
      if (activeFilter === 'needs-review' && !(d.needsReview > 0 || d.status === 'Needs review')) return false;
      if (activeFilter === 'in-review' && !(d.status === 'In review' || Boolean(d.current_reviewer))) return false;
      if (activeFilter === 'draft' && !(d.status === 'Draft' || d.extractionStatus === 'rejected')) return false;
      if (activeFilter === 'saved' && d.status !== 'Saved') return false;
      if (activeFilter === 'reviewed' && d.status !== 'Reviewed') return false;
      if (activeFilter === 'extracted' && d.extractionStatus !== 'extracted') return false;
      if (activeFilter === 'warnings' && !(d.extractionStatus === 'extracted_with_warnings' || (d.warnings && d.warnings.length > 0))) return false;
      if (activeFilter === 'rejected' && d.extractionStatus !== 'rejected') return false;
      if (
        (activeFilter === 'updated' || activeFilter === 'published') &&
        !(
          d.status === 'Published' ||
          d.status === 'Updated to vector DB' ||
          d.review_status === 'published' ||
          (d.vectorDbStatus && (d.vectorDbStatus.startsWith('Updated') || d.vectorDbStatus === 'Published')) ||
          d.isPublished
        )
      )
        return false;

      // Multi-select Agreement Type filter
      if (selectedAgreementTypes.length > 0) {
        const docAg = (d.agreement_type || d.agreementType || '').trim().toLowerCase();
        const matchesAg = selectedAgreementTypes.some((sel) => {
          const sVal = sel.trim().toLowerCase();
          return docAg === sVal || docAg.includes(sVal) || sVal.includes(docAg);
        });
        if (!matchesAg) return false;
      }

      // Multi-select Sectorial Category filter
      if (selectedSectorials.length > 0) {
        const docSec = (d.sectorial_category || d.sectorial || '').trim().toLowerCase();
        const matchesSec = selectedSectorials.some((sel) => {
          const sVal = sel.trim().toLowerCase();
          return docSec === sVal || docSec.includes(sVal) || sVal.includes(docSec);
        });
        if (!matchesSec) return false;
      }

      // Search filter across name, title, parties, reviewer, folder, agreement type, and sectorial category
      if (activeSearch && activeSearch.trim()) {
        const q = activeSearch.trim().toLowerCase();
        const matchesName = (d.name || '').toLowerCase().includes(q);
        const matchesTitle = d.title ? d.title.toLowerCase().includes(q) : false;
        const matchesParties = d.parties ? d.parties.toLowerCase().includes(q) : false;
        const matchesReviewer = d.reviewer ? d.reviewer.toLowerCase().includes(q) : false;
        const matchesFolder = d.folder ? d.folder.toLowerCase().includes(q) : false;
        const matchesAg = (d.agreement_type || d.agreementType || '').toLowerCase().includes(q);
        const matchesSec = (d.sectorial_category || d.sectorial || '').toLowerCase().includes(q);
        if (!matchesName && !matchesTitle && !matchesParties && !matchesReviewer && !matchesFolder && !matchesAg && !matchesSec) return false;
      }
      return true;
    });
  }, [allDocs, activeFilter, activeSearch, selectedAgreementTypes, selectedSectorials]);

  // Handle document row selection
  const handleSelectDoc = (doc) => {
    setSelectedDocId(doc.id || doc.documentId);
    setIsDrawerOpen(true);
  };

  // Open review workspace directly without api call
  const handleOpenWorkspace = (docToOpen) => {
    const targetDoc = docToOpen || selectedDoc;
    if (!targetDoc) return;
    if (onOpenWorkspace) {
      onOpenWorkspace(targetDoc);
    }
  };

  // Extraction Status badge helper
  const renderExtractionBadge = (status, warnings = []) => {
    if (status === 'published') {
      return (
        <Chip
          label="• Published"
          size="small"
          sx={{
            height: 22,
            fontSize: '11px',
            fontWeight: 600,
            bgcolor: '#dcfce7',
            color: '#166534',
            border: '1px solid #bbf7d0',
          }}
        />
      );
    }
    if (status === 'classified') {
      return (
        <Chip
          label="• Classified"
          size="small"
          sx={{
            height: 22,
            fontSize: '11px',
            fontWeight: 600,
            bgcolor: '#dcfce7',
            color: '#166534',
            border: '1px solid #bbf7d0',
          }}
        />
      );
    }
    if (status === 'extracted') {
      return (
        <Chip
          label="• Extracted"
          size="small"
          sx={{
            height: 22,
            fontSize: '11px',
            fontWeight: 600,
            bgcolor: '#e0f2fe',
            color: '#0369a1',
            border: '1px solid #bae6fd',
          }}
        />
      );
    }
    if (status === 'extracted_with_warnings') {
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Chip
            label="• Extracted"
            size="small"
            sx={{
              height: 22,
              fontSize: '11px',
              fontWeight: 600,
              bgcolor: '#fef3c7',
              color: '#92400e',
              border: '1px solid #fde68a',
            }}
          />
          <Chip
            label={`${warnings.length || 2} warnings`}
            size="small"
            sx={{
              height: 20,
              fontSize: '10.5px',
              fontWeight: 600,
              bgcolor: '#fee2e2',
              color: '#991b1b',
            }}
          />
        </Box>
      );
    }
    if (status === 'rejected') {
      return (
        <Chip
          icon={<CloseIcon sx={{ fontSize: '13px !important', color: '#991b1b' }} />}
          label="Rejected"
          size="small"
          sx={{
            height: 22,
            fontSize: '11px',
            fontWeight: 600,
            bgcolor: '#fee2e2',
            color: '#991b1b',
            border: '1px solid #fecaca',
            '& .MuiChip-icon': { ml: '6px', mr: '-2px' },
          }}
        />
      );
    }
    return (
      <Chip
        icon={
          <CircularProgress
            size={11}
            thickness={5}
            sx={{
              color: '#0284c7',
              animationDuration: '1s',
            }}
          />
        }
        label="Pending"
        size="small"
        sx={{
          height: 22,
          fontSize: '11px',
          fontWeight: 600,
          bgcolor: '#f0f9ff',
          color: '#0369a1',
          border: '1px solid #bae6fd',
          '& .MuiChip-icon': { ml: '6px', mr: '-2px' },
        }}
      />
    );
  };

  // Needs Review count badge helper
  const renderNeedsReviewBadge = (count) => {
    if (count === null || count === undefined) {
      return (
        <Typography sx={{ fontSize: '12px', color: '#94a3b8' }}>
          —
        </Typography>
      );
    }
    if (count > 0) {
      return (
        <Chip
          label={`${count} to review`}
          size="small"
          sx={{
            height: 22,
            fontSize: '11px',
            fontWeight: 700,
            bgcolor: '#fff7ed',
            color: '#c2410c',
            border: '1px solid #ffedd5',
          }}
        />
      );
    }
    return (
      <Chip
        label="Reviewed"
        size="small"
        sx={{
          height: 22,
          fontSize: '11px',
          fontWeight: 600,
          bgcolor: '#dcfce7',
          color: '#166534',
          border: '1px solid #bbf7d0',
        }}
      />
    );
  };

  // Vector DB Chip helper
  const renderVectorDbBadge = (status) => {
    if (status === 'Needs re-update') {
      return (
        <Chip
          label="Needs re-update"
          size="small"
          sx={{
            height: 22,
            fontSize: '11px',
            fontWeight: 600,
            bgcolor: '#fef3c7',
            color: '#92400e',
          }}
        />
      );
    }
    if (status && (status.startsWith('Updated') || status === 'Published')) {
      return (
        <Chip
          label="Published"
          size="small"
          sx={{
            height: 22,
            fontSize: '11px',
            fontWeight: 600,
            bgcolor: '#dcfce7',
            color: '#166534',
            border: '1px solid #bbf7d0',
          }}
        />
      );
    }
    return (
      <Chip
        label="Not sent yet"
        size="small"
        sx={{
          height: 22,
          fontSize: '11px',
          fontWeight: 500,
          bgcolor: '#f3f4f6',
          color: '#6b7280',
        }}
      />
    );
  };

  // Reviewer cell helper — horizontal display with at most 2 pills and "+N others" tooltip
  const renderReviewerCell = (doc) => {
    const rawReviewers = Array.isArray(doc.reviewers) ? doc.reviewers : [];
    const reviewers = Array.from(new Set(rawReviewers.filter(Boolean)));
    const currentRev = doc.current_reviewer;

    if (reviewers.length === 0 && !currentRev) {
      return (
        <Typography sx={{ fontSize: '12px', color: '#94a3b8' }}>
          Not assigned
        </Typography>
      );
    }

    const maxVisible = 2;
    const visibleReviewers = reviewers.slice(0, maxVisible);
    const extraCount = Math.max(0, reviewers.length - maxVisible);
    const remainingNames = extraCount > 0 ? reviewers.slice(maxVisible).join(', ') : '';

    return (
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6, flexWrap: 'nowrap' }}>
        {currentRev && (
          <Tooltip title={`Currently editing: ${currentRev}`} arrow>
            <Chip
              size="small"
              label={`✏ ${currentRev}`}
              sx={{
                height: 22,
                fontSize: '11px',
                bgcolor: '#e0f2fe',
                color: '#0369a1',
                fontWeight: 600,
                border: '1px solid #bae6fd',
                flexShrink: 0,
              }}
            />
          </Tooltip>
        )}
        {visibleReviewers.map((r) => (
          <Chip
            key={r}
            size="small"
            label={r}
            title={`Reviewer: ${r}`}
            sx={{
              height: 22,
              fontSize: '11px',
              bgcolor: '#f0fdf4',
              color: '#166534',
              border: '1px solid #bbf7d0',
              fontWeight: 600,
              flexShrink: 0,
            }}
          />
        ))}
        {extraCount > 0 && (
          <Tooltip title={remainingNames} arrow>
            <Chip
              size="small"
              label={`+${extraCount} other${extraCount > 1 ? 's' : ''}`}
              sx={{
                height: 22,
                fontSize: '11px',
                bgcolor: '#f8fafc',
                color: '#475569',
                border: '1px solid #cbd5e1',
                fontWeight: 600,
                flexShrink: 0,
                cursor: 'pointer',
                '&:hover': { bgcolor: '#f1f5f9' },
              }}
            />
          </Tooltip>
        )}
      </Box>
    );
  };

  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        bgcolor: '#ffffff',
      }}
    >
      {/* LEFT / MAIN DOCUMENTS TABLE VIEW */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflowY: 'auto',
          p: { xs: 2, sm: 3 },
          gap: 2,
          minWidth: 0,
        }}
      >
        {/* TOP BAR: Documents title + in this folder count + Sync / Folder picker + Search bar */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 2,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography
              variant="h5"
              sx={{
                fontWeight: 700,
                color: '#1b1f24',
                fontSize: '20px',
                letterSpacing: '-0.02em',
              }}
            >
              Documents
            </Typography>
            <Chip
              label={`${allDocs.length} ${allDocs.length === 1 ? 'file' : 'files'} in this folder`}
              size="small"
              sx={{
                height: 24,
                fontSize: '12px',
                bgcolor: '#f3f4f6',
                color: '#4b5563',
                fontWeight: 500,
              }}
            />
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {driveState.isConnected && onCheckDrive && (
              <Button
                variant="outlined"
                size="small"
                onClick={onCheckDrive}
                disabled={driveState.isSyncing}
                startIcon={<SyncIcon sx={{ fontSize: 16, animation: driveState.isSyncing ? 'spin 1s linear infinite' : 'none' }} />}
                sx={{
                  height: 32,
                  borderColor: '#cfcfc8',
                  color: '#1b1f24',
                  fontWeight: 600,
                  fontSize: '12px',
                  textTransform: 'none',
                  bgcolor: '#ffffff',
                  '&:hover': { bgcolor: '#f5f5f2', borderColor: '#b9cde0' },
                  '@keyframes spin': {
                    '0%': { transform: 'rotate(0deg)' },
                    '100%': { transform: 'rotate(360deg)' },
                  },
                }}
              >
                {driveState.isSyncing ? 'Syncing...' : 'Sync files'}
              </Button>
            )}

            <TextField
              size="small"
              placeholder="Search..."
              value={activeSearch}
              onChange={(e) => handleSearchChange(e.target.value)}
              sx={{
                width: { xs: 180, sm: 220 },
                '& .MuiOutlinedInput-root': {
                  height: 32,
                  fontSize: '12px',
                  bgcolor: '#fafaf8',
                  borderRadius: 1.5,
                  '& fieldset': { borderColor: '#e3e3de' },
                  '&:hover fieldset': { borderColor: '#b9cde0' },
                  '&.Mui-focused fieldset': { borderColor: '#1e3a5f' },
                },
              }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon sx={{ color: '#7b838c', fontSize: 16 }} />
                    </InputAdornment>
                  ),
                },
              }}
            />
          </Box>
        </Box>

        {/* FILTER BAR: Status Tabs + Type & Reviewer Dropdowns */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 1.5,
          }}
        >
          {/* Status Tabs/Chips */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            {[
              { id: 'all', label: `All ${counts.all}` },
              { id: 'needs-review', label: `Needs review ${counts.needsReview}` },
              { id: 'in-review', label: `In review ${counts.inReview}` },
              // { id: 'saved', label: `Saved ${counts.saved}` },
              { id: 'reviewed', label: `Reviewed ${counts.inreviewed}` },
              { id: 'published', label: `Published ${counts.published}` },
            ].map((tab) => {
              const isSelected = activeFilter === tab.id;
              return (
                <Button
                  key={tab.id}
                  size="small"
                  onClick={() => setActiveFilter(tab.id)}
                  sx={{
                    height: 28,
                    fontSize: '11.5px',
                    fontWeight: isSelected ? 600 : 500,
                    textTransform: 'none',
                    px: 1.25,
                    borderRadius: 1.5,
                    bgcolor: isSelected ? '#ffffff' : '#f8fafc',
                    color: isSelected ? '#1b1f24' : '#64748b',
                    border: '1px solid',
                    borderColor: isSelected ? '#cbd5e1' : '#e2e8f0',
                    boxShadow: isSelected ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                    '&:hover': {
                      bgcolor: '#ffffff',
                      borderColor: '#94a3b8',
                    },
                  }}
                >
                  {tab.label}
                </Button>
              );
            })}
          </Box>

          {/* Multi-Select Dropdown Filters: Agreement Type and Sectorial Category */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            {/* Agreement Type Multi-select Filter */}
            <Button
              size="small"
              endIcon={<KeyboardArrowDownIcon sx={{ fontSize: 14 }} />}
              onClick={(e) => setAgreementMenuAnchor(e.currentTarget)}
              sx={{
                height: 28,
                fontSize: '11.5px',
                fontWeight: selectedAgreementTypes.length > 0 ? 600 : 500,
                textTransform: 'none',
                px: 1.25,
                bgcolor: selectedAgreementTypes.length > 0 ? '#eff6ff' : '#ffffff',
                color: selectedAgreementTypes.length > 0 ? '#1d4ed8' : '#475569',
                border: '1px solid',
                borderColor: selectedAgreementTypes.length > 0 ? '#bfdbfe' : '#e2e8f0',
                borderRadius: 1.5,
                maxWidth: 240,
                '&:hover': { bgcolor: selectedAgreementTypes.length > 0 ? '#dbeafe' : '#f8fafc' },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, overflow: 'hidden' }}>
                <Typography
                  noWrap
                  sx={{
                    fontSize: '11.5px',
                    fontWeight: 'inherit',
                    color: 'inherit',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {selectedAgreementTypes.length === 0
                    ? 'All agreement types'
                    : selectedAgreementTypes.length === 1
                      ? selectedAgreementTypes[0]
                      : `${selectedAgreementTypes.length} agreement types`}
                </Typography>
                {selectedAgreementTypes.length > 1 && (
                  <Box
                    component="span"
                    sx={{
                      bgcolor: '#1d4ed8',
                      color: '#ffffff',
                      borderRadius: '10px',
                      px: 0.7,
                      py: 0.1,
                      fontSize: '10px',
                      fontWeight: 700,
                      lineHeight: 1.2,
                      flexShrink: 0,
                    }}
                  >
                    {selectedAgreementTypes.length}
                  </Box>
                )}
              </Box>
            </Button>
            <Menu
              anchorEl={agreementMenuAnchor}
              open={Boolean(agreementMenuAnchor)}
              onClose={() => setAgreementMenuAnchor(null)}
              slotProps={{
                paper: {
                  sx: {
                    maxHeight: 380,
                    width: 320,
                    borderRadius: 2,
                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
                    border: '1px solid #e2e8f0',
                    p: 0,
                  },
                },
              }}
            >
              <Box sx={{ p: 1, pb: 0.5, borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography sx={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', px: 1 }}>
                  Agreement Types {selectedAgreementTypes.length > 0 ? `(${selectedAgreementTypes.length} selected)` : ''}
                </Typography>
                {selectedAgreementTypes.length > 0 && (
                  <Button
                    size="small"
                    onClick={() => setSelectedAgreementTypes([])}
                    sx={{ fontSize: '11px', textTransform: 'none', py: 0.25, px: 0.75, minWidth: 0, color: '#dc2626' }}
                  >
                    Clear all
                  </Button>
                )}
              </Box>
              <Box sx={{ maxHeight: 260, overflowY: 'auto', py: 0.5 }}>
                <MenuItem
                  onClick={() => setSelectedAgreementTypes([])}
                  sx={{
                    fontSize: '12.5px',
                    fontWeight: selectedAgreementTypes.length === 0 ? 600 : 400,
                    bgcolor: selectedAgreementTypes.length === 0 ? '#f0f9ff' : 'transparent',
                    py: 0.75,
                  }}
                >
                  <Checkbox
                    checked={selectedAgreementTypes.length === 0}
                    size="small"
                    sx={{ p: 0.5, mr: 1, color: '#cbd5e1', '&.Mui-checked': { color: '#0284c7' } }}
                  />
                  <Typography sx={{ fontSize: '12.5px', fontWeight: selectedAgreementTypes.length === 0 ? 600 : 400 }}>
                    All agreement types
                  </Typography>
                </MenuItem>
                {AGREEMENT_TYPES.map((type) => {
                  const isChecked = selectedAgreementTypes.includes(type);
                  return (
                    <MenuItem
                      key={type}
                      onClick={(e) => {
                        e.preventDefault();
                        setSelectedAgreementTypes((prev) =>
                          prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
                        );
                      }}
                      sx={{
                        fontSize: '12.5px',
                        fontWeight: isChecked ? 600 : 400,
                        bgcolor: isChecked ? '#eff6ff' : 'transparent',
                        py: 0.75,
                        '&:hover': { bgcolor: isChecked ? '#dbeafe' : '#f8fafc' },
                      }}
                    >
                      <Checkbox
                        checked={isChecked}
                        size="small"
                        sx={{ p: 0.5, mr: 1, color: '#cbd5e1', '&.Mui-checked': { color: '#1d4ed8' } }}
                      />
                      <Typography sx={{ fontSize: '12.5px', fontWeight: isChecked ? 600 : 400 }}>
                        {type}
                      </Typography>
                    </MenuItem>
                  );
                })}
              </Box>
              <Box sx={{ p: 1, borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', bgcolor: '#fafafa' }}>
                <Button
                  variant="contained"
                  size="small"
                  onClick={() => setAgreementMenuAnchor(null)}
                  sx={{
                    height: 26,
                    fontSize: '11.5px',
                    textTransform: 'none',
                    bgcolor: '#1e3a5f',
                    fontWeight: 600,
                    px: 2,
                    '&:hover': { bgcolor: '#0f172a' },
                  }}
                >
                  Done
                </Button>
              </Box>
            </Menu>

            {/* Sectorial Category Multi-select Filter */}
            <Button
              size="small"
              endIcon={<KeyboardArrowDownIcon sx={{ fontSize: 14 }} />}
              onClick={(e) => setSectorialMenuAnchor(e.currentTarget)}
              sx={{
                height: 28,
                fontSize: '11.5px',
                fontWeight: selectedSectorials.length > 0 ? 600 : 500,
                textTransform: 'none',
                px: 1.25,
                bgcolor: selectedSectorials.length > 0 ? '#f0fdf4' : '#ffffff',
                color: selectedSectorials.length > 0 ? '#166534' : '#475569',
                border: '1px solid',
                borderColor: selectedSectorials.length > 0 ? '#bbf7d0' : '#e2e8f0',
                borderRadius: 1.5,
                maxWidth: 240,
                '&:hover': { bgcolor: selectedSectorials.length > 0 ? '#dcfce7' : '#f8fafc' },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, overflow: 'hidden' }}>
                <Typography
                  noWrap
                  sx={{
                    fontSize: '11.5px',
                    fontWeight: 'inherit',
                    color: 'inherit',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {selectedSectorials.length === 0
                    ? 'All sectorial categories'
                    : selectedSectorials.length === 1
                      ? selectedSectorials[0]
                      : `${selectedSectorials.length} sectorial categories`}
                </Typography>
                {selectedSectorials.length > 1 && (
                  <Box
                    component="span"
                    sx={{
                      bgcolor: '#166534',
                      color: '#ffffff',
                      borderRadius: '10px',
                      px: 0.7,
                      py: 0.1,
                      fontSize: '10px',
                      fontWeight: 700,
                      lineHeight: 1.2,
                      flexShrink: 0,
                    }}
                  >
                    {selectedSectorials.length}
                  </Box>
                )}
              </Box>
            </Button>
            <Menu
              anchorEl={sectorialMenuAnchor}
              open={Boolean(sectorialMenuAnchor)}
              onClose={() => setSectorialMenuAnchor(null)}
              slotProps={{
                paper: {
                  sx: {
                    maxHeight: 380,
                    width: 340,
                    borderRadius: 2,
                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
                    border: '1px solid #e2e8f0',
                    p: 0,
                  },
                },
              }}
            >
              <Box sx={{ p: 1, pb: 0.5, borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography sx={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', px: 1 }}>
                  Sectorial Categories {selectedSectorials.length > 0 ? `(${selectedSectorials.length} selected)` : ''}
                </Typography>
                {selectedSectorials.length > 0 && (
                  <Button
                    size="small"
                    onClick={() => setSelectedSectorials([])}
                    sx={{ fontSize: '11px', textTransform: 'none', py: 0.25, px: 0.75, minWidth: 0, color: '#dc2626' }}
                  >
                    Clear all
                  </Button>
                )}
              </Box>
              <Box sx={{ maxHeight: 260, overflowY: 'auto', py: 0.5 }}>
                <MenuItem
                  onClick={() => setSelectedSectorials([])}
                  sx={{
                    fontSize: '12.5px',
                    fontWeight: selectedSectorials.length === 0 ? 600 : 400,
                    bgcolor: selectedSectorials.length === 0 ? '#f0fdf4' : 'transparent',
                    py: 0.75,
                  }}
                >
                  <Checkbox
                    checked={selectedSectorials.length === 0}
                    size="small"
                    sx={{ p: 0.5, mr: 1, color: '#cbd5e1', '&.Mui-checked': { color: '#16a34a' } }}
                  />
                  <Typography sx={{ fontSize: '12.5px', fontWeight: selectedSectorials.length === 0 ? 600 : 400 }}>
                    All sectorial categories
                  </Typography>
                </MenuItem>
                {SECTORIAL_OPTIONS.map((sec) => {
                  const isChecked = selectedSectorials.includes(sec);
                  return (
                    <MenuItem
                      key={sec}
                      onClick={(e) => {
                        e.preventDefault();
                        setSelectedSectorials((prev) =>
                          prev.includes(sec) ? prev.filter((s) => s !== sec) : [...prev, sec]
                        );
                      }}
                      sx={{
                        fontSize: '12.5px',
                        fontWeight: isChecked ? 600 : 400,
                        bgcolor: isChecked ? '#f0fdf4' : 'transparent',
                        py: 0.75,
                        '&:hover': { bgcolor: isChecked ? '#dcfce7' : '#f8fafc' },
                      }}
                    >
                      <Checkbox
                        checked={isChecked}
                        size="small"
                        sx={{ p: 0.5, mr: 1, color: '#cbd5e1', '&.Mui-checked': { color: '#166534' } }}
                      />
                      <Typography sx={{ fontSize: '12.5px', fontWeight: isChecked ? 600 : 400 }}>
                        {sec}
                      </Typography>
                    </MenuItem>
                  );
                })}
              </Box>
              <Box sx={{ p: 1, borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', bgcolor: '#fafafa' }}>
                <Button
                  variant="contained"
                  size="small"
                  onClick={() => setSectorialMenuAnchor(null)}
                  sx={{
                    height: 26,
                    fontSize: '11.5px',
                    textTransform: 'none',
                    bgcolor: '#1e3a5f',
                    fontWeight: 600,
                    px: 2,
                    '&:hover': { bgcolor: '#0f172a' },
                  }}
                >
                  Done
                </Button>
              </Box>
            </Menu>

            {/* Clear Filters Button if any active */}
            {(selectedAgreementTypes.length > 0 || selectedSectorials.length > 0) && (
              <Button
                size="small"
                onClick={() => {
                  setSelectedAgreementTypes([]);
                  setSelectedSectorials([]);
                }}
                startIcon={<CloseIcon sx={{ fontSize: 13 }} />}
                sx={{
                  height: 28,
                  fontSize: '11px',
                  textTransform: 'none',
                  color: '#dc2626',
                  fontWeight: 600,
                  bgcolor: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 1.5,
                  px: 1,
                  '&:hover': { bgcolor: '#fee2e2' },
                }}
              >
                Clear filters ({selectedAgreementTypes.length + selectedSectorials.length})
              </Button>
            )}
          </Box>
        </Box>

        {/* DOCUMENTS TABLE OR EMPTY STATE */}
        {allDocs.length === 0 ? (
          <Box
            sx={{
              flex: 1,
              minHeight: 340,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              p: { xs: 3, sm: 5 },
              bgcolor: '#fafaf8',
              border: '1.5px dashed #cfcfc8',
              borderRadius: 2,
              gap: 1.75,
            }}
          >
            <Box
              sx={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                bgcolor: '#f5f5f2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#7b838c',
              }}
            >
              <DescriptionOutlinedIcon sx={{ fontSize: 28 }} />
            </Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#1b1f24', fontSize: '15px' }}>
              {queueCount > 0 ? 'Files are in Your Queue' : 'No documents found in Drive'}
            </Typography>
            <Typography variant="body2" sx={{ color: '#7b838c', maxWidth: 440, lineHeight: 1.5 }}>
              {queueCount > 0
                ? `You have ${queueCount} file${queueCount === 1 ? '' : 's'} currently in Your Queue waiting for extraction or classification. Once classified in the database, they will automatically appear here.`
                : driveState.isConnected
                  ? driveState.folderPath
                    ? `No files found in folder "${driveState.folderPath}". Please upload DOCX or PDF files into this folder or click Sync files.`
                    : 'Connected to Google Drive. Choose a folder from the Overview section to load contracts.'
                  : 'Connect your Google Drive account from the Overview section to load real contracts for review.'}
            </Typography>
            {queueCount > 0 ? (
              <Box sx={{ display: 'flex', gap: 1.5, mt: 1 }}>
                {onNavigateToOverview && (
                  <Button
                    variant="contained"
                    size="small"
                    onClick={onNavigateToOverview}
                    sx={{ bgcolor: '#1e3a5f', textTransform: 'none', fontWeight: 600 }}
                  >
                    View Your Queue ({queueCount})
                  </Button>
                )}
                {onCheckDrive && (
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={onCheckDrive}
                    disabled={driveState.isSyncing}
                    startIcon={<SyncIcon sx={{ fontSize: 16 }} />}
                    sx={{ textTransform: 'none', fontWeight: 600, borderColor: '#cfcfc8', color: '#1b1f24' }}
                  >
                    Sync status
                  </Button>
                )}
              </Box>
            ) : driveState.isConnected ? (
              <Box sx={{ display: 'flex', gap: 1.5, mt: 1 }}>
                {onOpenPicker && (
                  <Button
                    variant="contained"
                    size="small"
                    onClick={onOpenPicker}
                    sx={{ bgcolor: '#1e3a5f', textTransform: 'none', fontWeight: 600 }}
                  >
                    {driveState.folderPath ? 'Change folder' : 'Choose Drive folder'}
                  </Button>
                )}
                {onCheckDrive && (
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={onCheckDrive}
                    disabled={driveState.isSyncing}
                    startIcon={<SyncIcon sx={{ fontSize: 16 }} />}
                    sx={{ textTransform: 'none', fontWeight: 600, borderColor: '#cfcfc8', color: '#1b1f24' }}
                  >
                    Sync files
                  </Button>
                )}
              </Box>
            ) : (
              onConnectDrive && (
                <Button
                  variant="contained"
                  size="small"
                  onClick={onConnectDrive}
                  sx={{ bgcolor: '#1e3a5f', textTransform: 'none', fontWeight: 600, mt: 1 }}
                >
                  Connect with Google OAuth
                </Button>
              )
            )}
          </Box>
        ) : (
          <TableContainer
            sx={{
              flex: 1,
              borderRadius: 1.5,
              border: '1px solid #e2e8f0',
              bgcolor: '#ffffff',
            }}
          >
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ bgcolor: '#f8fafc', py: 1.25, fontSize: '12px', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0', width: 45 }}>
                    #
                  </TableCell>
                  <TableCell sx={{ bgcolor: '#f8fafc', py: 1.25, fontSize: '12px', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                    Document
                  </TableCell>
                  <TableCell sx={{ bgcolor: '#f8fafc', py: 1.25, fontSize: '12px', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0', width: 220 }}>
                    Extraction status
                  </TableCell>
                  <TableCell sx={{ bgcolor: '#f8fafc', py: 1.25, fontSize: '12px', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0', width: 160 }}>
                    Needs review
                  </TableCell>
                  <TableCell sx={{ bgcolor: '#f8fafc', py: 1.25, fontSize: '12px', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0', width: 230, minWidth: 200 }}>
                    Reviewer
                  </TableCell>
                  {/* <TableCell sx={{ bgcolor: '#f8fafc', py: 1.25, fontSize: '12px', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0', width: 170 }}>
                    Vector DB
                  </TableCell> */}
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredDocs.map((doc, index) => {
                  const isSelected = selectedDoc?.id === doc.id;
                  const reviewerName = doc.reviewer || currentUserName;

                  return (
                    <TableRow
                      key={doc.id}
                      hover
                      onClick={() => handleSelectDoc(doc)}
                      onDoubleClick={() => handleOpenWorkspace(doc)}
                      sx={{
                        cursor: 'pointer',
                        bgcolor: isSelected ? '#f8fafc' : '#ffffff',
                        borderLeft: isSelected ? '3px solid #1e3a5f' : '3px solid transparent',
                        '&:hover': { bgcolor: isSelected ? '#f1f5f9' : '#f8fafc' },
                      }}
                    >
                      {/* Serial number */}
                      <TableCell sx={{ py: 1.4, fontSize: '12px', fontWeight: 600, color: '#64748b', width: 45 }}>
                        {index + 1}
                      </TableCell>

                      {/* Document Info + Reviewer beside document name */}
                      <TableCell sx={{ py: 1.4 }}>
                        <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 0.35 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                            <Typography
                              sx={{
                                fontSize: '13.5px',
                                fontWeight: 600,
                                color: '#0f172a',
                                lineHeight: 1.3,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {doc.name}
                            </Typography>
                            {/* {doc.status === 'Saved' && (
                              <Chip
                                label="Saved"
                                size="small"
                                sx={{
                                  height: 20,
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  bgcolor: '#ecfdf5',
                                  color: '#065f46',
                                  border: '1px solid #a7f3d0',
                                }}
                              />
                            )}
                            {(doc.status === 'Published' ||
                              doc.status === 'Updated to vector DB' ||
                              doc.review_status === 'published' ||
                              (doc.vectorDbStatus && (doc.vectorDbStatus.startsWith('Updated') || doc.vectorDbStatus === 'Published')) ||
                              doc.isPublished) && (
                              <Chip
                                label="Published"
                                size="small"
                                sx={{
                                  height: 20,
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  bgcolor: '#dcfce7',
                                  color: '#166534',
                                  border: '1px solid #bbf7d0',
                                }}
                              />
                            )} */}
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mt: 0.25 }}>
                            <Typography sx={{ fontSize: '11px', color: '#475569', fontWeight: 500 }}>
                              <Box component="span" sx={{ color: '#64748b', fontWeight: 400 }}>Agreement: </Box>
                              {doc.agreement_type || doc.agreementType || '—'}
                            </Typography>
                            <Box component="span" sx={{ color: '#cbd5e1' }}>•</Box>
                            <Typography sx={{ fontSize: '11px', color: '#475569', fontWeight: 500 }}>
                              <Box component="span" sx={{ color: '#64748b', fontWeight: 400 }}>Sector: </Box>
                              {doc.sectorial_category || doc.sectorial || '—'}
                            </Typography>
                          </Box>
                          {/* <Typography sx={{ fontSize: '11.5px', color: '#64748b', letterSpacing: '0.01em', mt: 0.2 }}>
                            pages: {doc.pages ?? 0} · clauses: {doc.clauses ?? 0} · paragraphs: {doc.paragraphs ?? 0} · {doc.size}
                          </Typography> */}
                        </Box>
                      </TableCell>

                      {/* Extraction status */}
                      <TableCell sx={{ py: 1.4 }}>
                        {renderExtractionBadge(doc.extractionStatus, doc.warnings)}
                      </TableCell>

                      {/* Needs review (display count) */}
                      <TableCell sx={{ py: 1.4 }}>
                        {renderNeedsReviewBadge(doc.needsReview)}
                      </TableCell>

                      {/* Reviewer — horizontal display */}
                      <TableCell sx={{ py: 1.4 }}>
                        {renderReviewerCell(doc)}
                      </TableCell>

                      {/* Vector DB */}
                      {/* <TableCell sx={{ py: 1.4 }}>
                        {renderVectorDbBadge(doc.vectorDbStatus)}
                      </TableCell> */}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* Footer pagination info */}
        {allDocs.length > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1 }}>
            <Typography sx={{ fontSize: '12px', color: '#64748b' }}>
              Showing 1–{filteredDocs.length} of {allDocs.length} documents
            </Typography>
          </Box>
        )}
      </Box>

      {/* RIGHT SIDE DETAIL DRAWER / POPUP BOX FOR SELECTED DRIVE DOCUMENT */}
      {selectedDoc && isDrawerOpen && (
        <Box
          sx={{
            width: { xs: 320, sm: 360, md: 390 },
            minWidth: { xs: 320, sm: 360, md: 390 },
            height: '100%',
            bgcolor: '#ffffff',
            borderLeft: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            p: 2.75,
            gap: 2.5,
            boxShadow: '-2px 0 8px rgba(0,0,0,0.03)',
          }}
        >
          {/* Header (No docx logo), Title, Meta and Close button */}
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
              <Typography
                sx={{
                  fontSize: '15px',
                  fontWeight: 700,
                  color: '#0f172a',
                  lineHeight: 1.3,
                  wordBreak: 'break-word',
                }}
              >
                {selectedDoc.name}
              </Typography>

            </Box>

            <IconButton
              size="small"
              onClick={() => setIsDrawerOpen(false)}
              sx={{ color: '#94a3b8', p: 0.5, '&:hover': { color: '#0f172a' }, flexShrink: 0 }}
            >
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>

          {/* Status Badges Row: Extraction Status & Needs Review */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            {renderExtractionBadge(selectedDoc.extractionStatus, selectedDoc.warnings)}
            {selectedDoc.needsReview !== null && renderNeedsReviewBadge(selectedDoc.needsReview)}
            {selectedDoc.vectorDbStatus && selectedDoc.vectorDbStatus.startsWith('Updated') && (
              <Chip
                label={selectedDoc.vectorDbStatus}
                size="small"
                sx={{
                  height: 22,
                  fontSize: '11px',
                  fontWeight: 600,
                  bgcolor: '#dcfce7',
                  color: '#166534',
                }}
              />
            )}
          </Box>

          {/* Extraction Status & Needs Review Cards & Current Reviewer (Replaced Review Progress) */}
          {/* <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 1.25,
            }}
          > */}
          {/* Extraction Status card */}
          {/* <Box
              sx={{
                p: 1.5,
                borderRadius: 2,
                bgcolor: '#f8fafc',
                border: '1px solid #e2e8f0',
                display: 'flex',
                flexDirection: 'column',
                gap: 0.5,
              }}
            >
              <Typography sx={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Extraction
              </Typography>
              <Typography sx={{ fontSize: '13px', fontWeight: 700, color: selectedDoc.extractionStatus === 'rejected' ? '#b91c1c' : '#0f172a', textTransform: 'capitalize' }}>
                {selectedDoc.extractionStatus ? selectedDoc.extractionStatus.replace(/_/g, ' ') : 'Pending'}
              </Typography>
              {selectedDoc.warnings && selectedDoc.warnings.length > 0 && (
                <Typography sx={{ fontSize: '10.5px', color: '#b45309', fontWeight: 500 }}>
                  {selectedDoc.warnings.length} warning{selectedDoc.warnings.length > 1 ? 's' : ''} reported
                </Typography>
              )}
            </Box>  */}

          {/* Needs Review card (display count) */}
          {/* <Box
              sx={{
                p: 1.5,
                borderRadius: 2,
                bgcolor: selectedDoc.needsReview > 0 ? '#fff7ed' : '#f8fafc',
                border: '1px solid',
                borderColor: selectedDoc.needsReview > 0 ? '#ffedd5' : '#e2e8f0',
                display: 'flex',
                flexDirection: 'column',
                gap: 0.5,
              }}
            >
              <Typography sx={{ fontSize: '11px', fontWeight: 600, color: selectedDoc.needsReview > 0 ? '#c2410c' : '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Needs Review
              </Typography>
              <Typography sx={{ fontSize: '18px', fontWeight: 800, color: selectedDoc.needsReview > 0 ? '#ea580c' : '#334155' }}>
                {selectedDoc.needsReview !== null ? selectedDoc.needsReview : '—'}
              </Typography>
              <Typography sx={{ fontSize: '10.5px', color: selectedDoc.needsReview > 0 ? '#9a3412' : '#64748b' }}>
                {selectedDoc.needsReview > 0 ? 'items to verify' : 'All clear'}
              </Typography>
            </Box> */}

          {/* Current Reviewer card */}
          {/* <Box
              sx={{
                p: 1.5,
                borderRadius: 2,
                bgcolor: selectedDoc.current_reviewer ? '#eff6ff' : '#f8fafc',
                border: '1px solid',
                borderColor: selectedDoc.current_reviewer ? '#bfdbfe' : '#e2e8f0',
                display: 'flex',
                flexDirection: 'column',
                gap: 0.5,
              }}
            >
              <Typography sx={{ fontSize: '11px', fontWeight: 600, color: selectedDoc.current_reviewer ? '#1d4ed8' : '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Current reviewer
              </Typography>
              <Typography
                sx={{
                  fontSize: '13px',
                  fontWeight: 700,
                  color: selectedDoc.current_reviewer ? '#1e3a5f' : '#64748b',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {selectedDoc.current_reviewer ? selectedDoc.current_reviewer : 'null'}
              </Typography>
              <Typography sx={{ fontSize: '10.5px', color: selectedDoc.current_reviewer ? '#2563eb' : '#94a3b8' }}>
                {selectedDoc.current_reviewer ? 'In review' : 'No reviewer'}
              </Typography>
            </Box> */}
          {/* </Box> */}

          {/* Details Section */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography sx={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
              Details
            </Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 100 }}>
                  Extraction status
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 600, color: '#0f172a', textAlign: 'right', textTransform: 'capitalize' }}>
                  {selectedDoc.extractionStatus ? selectedDoc.extractionStatus.replace(/_/g, ' ') : 'Pending'}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 100 }}>
                  Needs review
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 600, color: selectedDoc.needsReview > 0 ? '#c2410c' : '#166534', textAlign: 'right' }}>
                  {selectedDoc.needsReview === 0
                    ? 'Reviewed'
                    : selectedDoc.needsReview !== null
                      ? `${selectedDoc.needsReview} items`
                      : 'Reviewed'}
                </Typography>
              </Box>



              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 110 }}>
                  Agreement type
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 600, color: '#0f172a', textAlign: 'right' }}>
                  {selectedDoc.agreement_type || selectedDoc.agreementType || '—'}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 110 }}>
                  Sectorial category
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 600, color: '#0f172a', textAlign: 'right' }}>
                  {selectedDoc.sectorial_category || selectedDoc.sectorial || '—'}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 100 }}>
                  Pages
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 500, color: '#0f172a', textAlign: 'right' }}>
                  {selectedDoc.pages ?? 0}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 100 }}>
                  Clauses
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 500, color: '#0f172a', textAlign: 'right' }}>
                  {selectedDoc.clauses ?? 0}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 110 }}>
                  Agreement type
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 600, color: '#0f172a', textAlign: 'right' }}>
                  {selectedDoc.agreement_type || selectedDoc.agreementType || '—'}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 110 }}>
                  Sectorial category
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 600, color: '#0f172a', textAlign: 'right' }}>
                  {selectedDoc.sectorial_category || selectedDoc.sectorial || '—'}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 100 }}>
                  Paragraphs
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 500, color: '#0f172a', textAlign: 'right' }}>
                  {selectedDoc.paragraphs ?? 0}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 100 }}>
                  Size
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 500, color: '#0f172a', textAlign: 'right' }}>
                  {selectedDoc.size}
                </Typography>
              </Box>

              {/* <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 100 }}>
                  In Drive since
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 500, color: '#0f172a', textAlign: 'right' }}>
                  {selectedDoc.inDriveSince}
                </Typography>
              </Box> */}

              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 110 }}>
                  Active editor
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 600, color: selectedDoc.current_reviewer ? '#0f172a' : '#64748b', textAlign: 'right' }}>
                  {selectedDoc.current_reviewer || '—'}
                </Typography>
              </Box>

              {(selectedDoc.reviewers || []).length > 0 && (() => {
                const revList = Array.from(new Set((selectedDoc.reviewers || []).filter(Boolean)));
                const visible = revList.slice(0, 3);
                const extra = Math.max(0, revList.length - 3);
                const extraNames = extra > 0 ? revList.slice(3).join(', ') : '';

                return (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5, alignItems: 'center' }}>
                    <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 90 }}>
                      Reviewers
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {visible.map((r) => (
                        <Chip
                          key={r}
                          label={r}
                          size="small"
                          sx={{
                            height: 20,
                            fontSize: '11px',
                            bgcolor: '#f0fdf4',
                            color: '#166534',
                            border: '1px solid #bbf7d0',
                            fontWeight: 600,
                          }}
                        />
                      ))}
                      {extra > 0 && (
                        <Tooltip title={extraNames} arrow>
                          <Chip
                            label={`+${extra} other${extra > 1 ? 's' : ''}`}
                            size="small"
                            sx={{
                              height: 20,
                              fontSize: '11px',
                              bgcolor: '#f8fafc',
                              color: '#475569',
                              border: '1px solid #cbd5e1',
                              fontWeight: 600,
                              cursor: 'pointer',
                              '&:hover': { bgcolor: '#f1f5f9' },
                            }}
                          />
                        </Tooltip>
                      )}
                    </Box>
                  </Box>
                );
              })()}

              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 100 }}>
                  Last extracted
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 500, color: '#0f172a', textAlign: 'right' }}>
                  {selectedDoc.lastExtracted || selectedDoc.lastSaved}
                </Typography>
              </Box>

              {/* <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 100 }}>
                  Vector DB
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 500, color: '#0f172a', textAlign: 'right' }}>
                  {selectedDoc.vectorDbDetail}
                </Typography>
              </Box> */}
            </Box>
          </Box>

          {/* Recent Activity Section */}
          {/* <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography sx={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
              Recent activity
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
              <Box
                sx={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  bgcolor: '#e2e8f0',
                  border: '2px solid #94a3b8',
                  mt: 0.25,
                  flexShrink: 0,
                }}
              />
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                <Typography sx={{ fontSize: '12px', color: '#1e293b', lineHeight: 1.35 }}>
                  <strong style={{ fontWeight: 600 }}>{selectedDoc.recentActivity?.user}</strong>{' '}
                  {selectedDoc.recentActivity?.action}
                </Typography>
                <Typography sx={{ fontSize: '11px', color: '#94a3b8' }}>
                  {selectedDoc.recentActivity?.timestamp}
                </Typography>
              </Box>
            </Box>
          </Box> */}

          {/* Bottom Button: Open review workspace */}
          <Box sx={{ mt: 'auto', pt: 1 }}>
            <Button
              variant="contained"
              fullWidth
              disabled={!selectedDoc}
              onClick={() => handleOpenWorkspace(selectedDoc)}
              sx={{
                bgcolor: '#1e3a5f',
                color: '#ffffff',
                textTransform: 'none',
                fontWeight: 600,
                fontSize: '13px',
                py: 1.1,
                borderRadius: 1.5,
                boxShadow: 'none',
                '&:hover': {
                  bgcolor: '#152943',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                },
                '&.Mui-disabled': {
                  bgcolor: '#94a3b8',
                  color: '#ffffff',
                },
              }}
            >
              Open review workspace
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}
