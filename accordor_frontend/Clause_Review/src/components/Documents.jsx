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

  // Format real documents from backend pipeline API or Google Drive and strictly deduplicate by document name
  const allDocs = useMemo(() => {
    if (!documents || documents.length === 0 || isEmptyData) {
      return [];
    }

    // Deduplicate by normalized document name to ensure every document appears at most ONCE
    const uniqueMap = new Map();
    documents.forEach((d, idx) => {
      const nameKey = (d.name || d.fileName || '').trim().toLowerCase();
      if (!nameKey) {
        uniqueMap.set(String(d.id || d.document_id || idx), d);
        return;
      }
      if (!uniqueMap.has(nameKey)) {
        uniqueMap.set(nameKey, d);
      } else {
        const existing = uniqueMap.get(nameKey);
        const existingStatus = (existing.extraction_status || existing.extractionStatus || '').toLowerCase();
        const newStatus = (d.extraction_status || d.extractionStatus || '').toLowerCase();
        const existingClassified = existingStatus === 'classified' || Boolean(existing.stages?.classification || existing.classified);
        const newClassified = newStatus === 'classified' || Boolean(d.stages?.classification || d.classified);
        if (!existingClassified && newClassified) {
          uniqueMap.set(nameKey, d);
        } else if (existingClassified && !newClassified) {
          // Keep existing classified document
        } else {
          const existingPages = existing.pages ?? existing.stages?.extraction?.pages ?? 0;
          const newPages = d.pages ?? d.stages?.extraction?.pages ?? 0;
          const isExistingExtracted = existingStatus === 'extracted' || existingStatus === 'extracted_with_warnings';
          const isNewExtracted = newStatus === 'extracted' || newStatus === 'extracted_with_warnings';
          if (!isExistingExtracted && isNewExtracted) {
            uniqueMap.set(nameKey, d);
          } else if (newPages > existingPages) {
            uniqueMap.set(nameKey, d);
          }
        }
      }
    });

    const uniqueDocs = Array.from(uniqueMap.values());

    return uniqueDocs.map((d, i) => {
      const extraction = d.stages?.extraction;
      const classification = d.stages?.classification;
      const pages = d.pages ?? extraction?.pages ?? 0;
      const clauses = d.clauses ?? extraction?.clauses ?? 0;
      const paragraphs = d.paragraphs ?? extraction?.paragraphs ?? 0;
      const rawExtractionStatus = (
        d.extraction_status ||
        d.extractionStatus ||
        extraction?.status ||
        'pending'
      ).toLowerCase();
      const isClassified =
        rawExtractionStatus === 'classified' ||
        (d.status && String(d.status).toLowerCase() === 'classified') ||
        d.classified === true ||
        Boolean(classification && (classification.status === 'succeeded' || (classification.micro_chunks && classification.micro_chunks > 0) || classification.id));
      const extractionStatus = isClassified ? 'classified' : rawExtractionStatus;
      const needsReview = d.needsReview ?? classification?.needs_review ?? null;
      const warnings = d.warnings || extraction?.warnings || [];
      const size = d.size || (pages > 0 ? `${Math.max(12, Math.round(pages * 26.5))} KB` : '24 KB');
      const currentReviewer = d.current_reviewer !== undefined
        ? d.current_reviewer
        : (d.rawDoc?.current_reviewer !== undefined ? d.rawDoc.current_reviewer : null);

      return {
        id: d.id || d.document_id || `doc-${i}`,
        documentId: d.document_id || d.id || `doc-${i}`,
        name: d.name || 'Untitled Document',
        fileName: d.name || 'document.docx',
        title: d.title || d.name,
        agreement_type: d.agreement_type || d.agreementType || d.rawDoc?.agreement_type || d.rawDoc?.metadata?.agreement_type || '',
        sectorial_category: d.sectorial_category || d.sectorial || d.rawDoc?.sectorial_category || d.rawDoc?.metadata?.sectorial_category || '',
        agreementType: d.agreement_type || d.agreementType || d.rawDoc?.agreement_type || d.rawDoc?.metadata?.agreement_type || '',
        sectorial: d.sectorial_category || d.sectorial || d.rawDoc?.sectorial_category || d.rawDoc?.metadata?.sectorial_category || '',
        pages,
        clauses,
        paragraphs,
        size,
        extractionStatus,
        needsReview,
        warnings,
        stages: d.stages || {},
        current_reviewer: currentReviewer,
        currentReviewer: currentReviewer,
        status: (d.status === 'Saved' || d.isSaved) ? 'Saved' : (d.status || (currentReviewer ? 'In review' : (isClassified ? (needsReview > 0 ? 'Needs review' : 'Reviewed') : extractionStatus === 'extracted' ? (needsReview > 0 ? 'Needs review' : 'Reviewed') : extractionStatus === 'extracted_with_warnings' ? 'Needs review' : extractionStatus === 'rejected' ? 'Draft' : 'Needs review'))),
        statusTag: d.statusTag || (warnings.length > 0 ? `${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : null),
        vectorDbStatus: d.vectorDbStatus || 'Not sent yet',
        vectorDbDetail: d.vectorDbDetail || '',
        parties: d.parties || (d.folder || driveState.folderPath ? `Folder: ${d.folder || driveState.folderPath}` : 'Parties to Agreement'),
        inDriveSince: d.inDriveSince || (d.last_extracted_at ? new Date(d.last_extracted_at).toLocaleDateString() : (d.modifiedTime || 'Recently')),
        reviewer: currentReviewer || d.reviewer || currentUserName || driveState.user?.name || driveState.user?.email || 'Reviewer',
        lastSaved: d.lastSaved || (d.last_extracted_at ? new Date(d.last_extracted_at).toLocaleDateString() : (d.modifiedTime || 'Today')),
        lastExtracted: d.lastExtracted || (d.last_extracted_at ? new Date(d.last_extracted_at).toLocaleString() : null),
        folder: d.folder || driveState.folderPath || 'Google Drive',
        issues: d.issues || {
          duplicateParaId: 0,
          canonicalTypeMissing: needsReview ?? 0,
          paragraphsToReview: needsReview ?? (paragraphs - clauses > 0 ? paragraphs - clauses : 0),
          warnings,
        },
        recentActivity: d.recentActivity || {
          user: driveState.user?.name || 'System',
          action: isClassified ? 'Pipeline classification completed' : extractionStatus === 'extracted' ? 'Last extraction completed' : extractionStatus === 'rejected' ? 'Document rejected by parser' : 'File ready from Google Drive',
          timestamp: d.modifiedTime || (d.last_extracted_at ? new Date(d.last_extracted_at).toLocaleDateString() : 'Today'),
        },
        webViewLink: d.webViewLink || d.drive_web_link,
      };
    });
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

  const [selectedDocId, setSelectedDocId] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [selectedAgreementType, setSelectedAgreementType] = useState('all');
  const [selectedSectorial, setSelectedSectorial] = useState('all');
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

  // Counts for tabs
  const counts = useMemo(() => {
    const draftCount = allDocs.filter((d) => d.status === 'Draft' || d.extractionStatus === 'rejected').length;
    const reviewedCount = allDocs.filter((d) => d.status === 'Reviewed').length;
    const publishedCount = allDocs.filter(
      (d) =>
        d.status === 'Published' ||
        d.status === 'Updated to vector DB' ||
        d.review_status === 'published' ||
        (d.vectorDbStatus && (d.vectorDbStatus.startsWith('Updated') || d.vectorDbStatus === 'Published')) ||
        d.isPublished
    ).length;
    return {
      all: allDocs.length,
      needsReview: allDocs.filter((d) => (d.needsReview && d.needsReview > 0) || d.status === 'Needs review').length,
      inReview: allDocs.filter((d) => d.status === 'In review' || Boolean(d.current_reviewer)).length,
      draft: draftCount,
      indraft: draftCount,
      saved: allDocs.filter((d) => d.status === 'Saved').length,
      reviewed: reviewedCount,
      inreviewed: reviewedCount,
      published: publishedCount,
      extracted: allDocs.filter((d) => d.extractionStatus === 'extracted').length,
      warnings: allDocs.filter((d) => d.extractionStatus === 'extracted_with_warnings' || (d.warnings && d.warnings.length > 0)).length,
      rejected: allDocs.filter((d) => d.extractionStatus === 'rejected').length,
      updated: publishedCount,
    };
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

      // Agreement Type filter
      if (selectedAgreementType !== 'all') {
        const docAg = (d.agreement_type || d.agreementType || '').trim().toLowerCase();
        const filterAg = selectedAgreementType.trim().toLowerCase();
        if (docAg !== filterAg) return false;
      }

      // Sectorial Category filter
      if (selectedSectorial !== 'all') {
        const docSec = (d.sectorial_category || d.sectorial || '').trim().toLowerCase();
        const filterSec = selectedSectorial.trim().toLowerCase();
        if (docSec !== filterSec) return false;
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
  }, [allDocs, activeFilter, activeSearch, selectedAgreementType, selectedSectorial]);

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
        label="0"
        size="small"
        sx={{
          height: 22,
          fontSize: '11px',
          fontWeight: 600,
          bgcolor: '#f1f5f9',
          color: '#64748b',
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
              { id: 'saved', label: `Saved ${counts.saved}` },
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

          {/* Dropdown Filters: Agreement Type and Sectorial Category */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            {/* Agreement Type Filter */}
            <Button
              size="small"
              endIcon={<KeyboardArrowDownIcon sx={{ fontSize: 14 }} />}
              onClick={(e) => setAgreementMenuAnchor(e.currentTarget)}
              sx={{
                height: 28,
                fontSize: '11.5px',
                fontWeight: selectedAgreementType !== 'all' ? 600 : 500,
                textTransform: 'none',
                px: 1.25,
                bgcolor: selectedAgreementType !== 'all' ? '#eff6ff' : '#ffffff',
                color: selectedAgreementType !== 'all' ? '#1d4ed8' : '#475569',
                border: '1px solid',
                borderColor: selectedAgreementType !== 'all' ? '#bfdbfe' : '#e2e8f0',
                borderRadius: 1.5,
                maxWidth: 220,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                '&:hover': { bgcolor: selectedAgreementType !== 'all' ? '#dbeafe' : '#f8fafc' },
              }}
            >
              {selectedAgreementType === 'all'
                ? 'All agreement types'
                : selectedAgreementType.length > 22
                  ? `${selectedAgreementType.slice(0, 20)}...`
                  : selectedAgreementType}
            </Button>
            <Menu
              anchorEl={agreementMenuAnchor}
              open={Boolean(agreementMenuAnchor)}
              onClose={() => setAgreementMenuAnchor(null)}
              slotProps={{ paper: { sx: { maxHeight: 320, width: 280 } } }}
            >
              <MenuItem
                selected={selectedAgreementType === 'all'}
                onClick={() => {
                  setSelectedAgreementType('all');
                  setAgreementMenuAnchor(null);
                }}
                sx={{ fontSize: '12.5px', fontWeight: selectedAgreementType === 'all' ? 600 : 400 }}
              >
                All agreement types
              </MenuItem>
              {AGREEMENT_TYPES.map((type) => (
                <MenuItem
                  key={type}
                  selected={selectedAgreementType === type}
                  onClick={() => {
                    setSelectedAgreementType(type);
                    setAgreementMenuAnchor(null);
                  }}
                  sx={{ fontSize: '12.5px', fontWeight: selectedAgreementType === type ? 600 : 400 }}
                >
                  {type}
                </MenuItem>
              ))}
            </Menu>

            {/* Sectorial Category Filter */}
            <Button
              size="small"
              endIcon={<KeyboardArrowDownIcon sx={{ fontSize: 14 }} />}
              onClick={(e) => setSectorialMenuAnchor(e.currentTarget)}
              sx={{
                height: 28,
                fontSize: '11.5px',
                fontWeight: selectedSectorial !== 'all' ? 600 : 500,
                textTransform: 'none',
                px: 1.25,
                bgcolor: selectedSectorial !== 'all' ? '#f0fdf4' : '#ffffff',
                color: selectedSectorial !== 'all' ? '#166534' : '#475569',
                border: '1px solid',
                borderColor: selectedSectorial !== 'all' ? '#bbf7d0' : '#e2e8f0',
                borderRadius: 1.5,
                maxWidth: 220,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                '&:hover': { bgcolor: selectedSectorial !== 'all' ? '#dcfce7' : '#f8fafc' },
              }}
            >
              {selectedSectorial === 'all'
                ? 'All sectorial categories'
                : selectedSectorial.length > 22
                  ? `${selectedSectorial.slice(0, 20)}...`
                  : selectedSectorial}
            </Button>
            <Menu
              anchorEl={sectorialMenuAnchor}
              open={Boolean(sectorialMenuAnchor)}
              onClose={() => setSectorialMenuAnchor(null)}
              slotProps={{ paper: { sx: { maxHeight: 320, width: 300 } } }}
            >
              <MenuItem
                selected={selectedSectorial === 'all'}
                onClick={() => {
                  setSelectedSectorial('all');
                  setSectorialMenuAnchor(null);
                }}
                sx={{ fontSize: '12.5px', fontWeight: selectedSectorial === 'all' ? 600 : 400 }}
              >
                All sectorial categories
              </MenuItem>
              {SECTORIAL_OPTIONS.map((sec) => (
                <MenuItem
                  key={sec}
                  selected={selectedSectorial === sec}
                  onClick={() => {
                    setSelectedSectorial(sec);
                    setSectorialMenuAnchor(null);
                  }}
                  sx={{ fontSize: '12.5px', fontWeight: selectedSectorial === sec ? 600 : 400 }}
                >
                  {sec}
                </MenuItem>
              ))}
            </Menu>

            {/* Clear Filters Button if any active */}
            {(selectedAgreementType !== 'all' || selectedSectorial !== 'all') && (
              <Button
                size="small"
                onClick={() => {
                  setSelectedAgreementType('all');
                  setSelectedSectorial('all');
                }}
                sx={{
                  height: 28,
                  fontSize: '11px',
                  textTransform: 'none',
                  color: '#dc2626',
                  fontWeight: 600,
                  p: 0.5,
                  minWidth: 'auto',
                  '&:hover': { bgcolor: '#fef2f2' },
                }}
              >
                Reset filters
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
                  <TableCell sx={{ bgcolor: '#f8fafc', py: 1.25, fontSize: '12px', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0', width: 170 }}>
                    Reviewer
                  </TableCell>
                  <TableCell sx={{ bgcolor: '#f8fafc', py: 1.25, fontSize: '12px', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0', width: 170 }}>
                    Vector DB
                  </TableCell>
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
                            {doc.status === 'Saved' && (
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
                            )}
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

                      {/* Reviewer */}
                      <TableCell sx={{ py: 1.4 }}>
                        {doc.current_reviewer ? (
                          <Chip
                            size="small"
                            label={`${doc.current_reviewer}`}
                            sx={{
                              height: 20,
                              fontSize: '11px',
                              bgcolor: '#e0f2fe',
                              color: '#0369a1',
                              fontWeight: 600,
                              border: '1px solid #bae6fd',
                            }}
                          />
                        ) : (
                          <Typography sx={{ fontSize: '12px', color: '#64748b' }}>
                            Not assigned
                          </Typography>
                        )}
                      </TableCell>

                      {/* Vector DB */}
                      <TableCell sx={{ py: 1.4 }}>
                        {renderVectorDbBadge(doc.vectorDbStatus)}
                      </TableCell>
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
              <Typography sx={{ fontSize: '11.5px', color: '#64748b', letterSpacing: '0.01em' }}>
                pages: {selectedDoc.pages ?? 0} · clauses: {selectedDoc.clauses ?? 0} · paragraphs: {selectedDoc.paragraphs ?? 0} · {selectedDoc.size}
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
                <Typography sx={{ fontSize: '12px', fontWeight: 600, color: selectedDoc.needsReview > 0 ? '#c2410c' : '#0f172a', textAlign: 'right' }}>
                  {selectedDoc.needsReview !== null ? `${selectedDoc.needsReview} items` : 'All Clear'}
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
                  Current reviewer
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 600, color: selectedDoc.current_reviewer ? '#0f172a' : '#64748b', textAlign: 'right' }}>
                  {selectedDoc.current_reviewer ? selectedDoc.current_reviewer : 'null'}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 100 }}>
                  Last extracted
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 500, color: '#0f172a', textAlign: 'right' }}>
                  {selectedDoc.lastExtracted || selectedDoc.lastSaved}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 100 }}>
                  Vector DB
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 500, color: '#0f172a', textAlign: 'right' }}>
                  {selectedDoc.vectorDbDetail}
                </Typography>
              </Box>
            </Box>
          </Box>

          {/* Recent Activity Section */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
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
          </Box>

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
