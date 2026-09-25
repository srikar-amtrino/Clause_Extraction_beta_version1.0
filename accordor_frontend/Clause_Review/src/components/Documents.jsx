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
        const existingClassified = Boolean(existing.stages?.classification || existing.classified);
        const newClassified = Boolean(d.stages?.classification || d.classified);
        if (!existingClassified && newClassified) {
          uniqueMap.set(nameKey, d);
        } else if (existingClassified && !newClassified) {
          // Keep existing classified document
        } else {
          const existingPages = existing.pages ?? existing.stages?.extraction?.pages ?? 0;
          const newPages = d.pages ?? d.stages?.extraction?.pages ?? 0;
          const isExistingExtracted = (existing.extraction_status || existing.extractionStatus) === 'extracted';
          const isNewExtracted = (d.extraction_status || d.extractionStatus) === 'extracted';
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
      const extractionStatus = d.extractionStatus || d.extraction_status || extraction?.status || 'pending';
      const needsReview = d.needsReview ?? classification?.needs_review ?? null;
      const warnings = d.warnings || extraction?.warnings || [];
      const size = d.size || (pages > 0 ? `${Math.max(12, Math.round(pages * 26.5))} KB` : '24 KB');

      return {
        id: d.id || d.document_id || `doc-${i}`,
        documentId: d.document_id || d.id || `doc-${i}`,
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
        parties: d.parties || (d.folder || driveState.folderPath ? `Folder: ${d.folder || driveState.folderPath}` : 'Parties to Agreement'),
        inDriveSince: d.inDriveSince || (d.last_extracted_at ? new Date(d.last_extracted_at).toLocaleDateString() : (d.modifiedTime || 'Recently')),
        reviewer: d.reviewer || currentUserName || driveState.user?.name || driveState.user?.email || 'Reviewer',
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
          action: extractionStatus === 'extracted' ? 'Last extraction completed' : extractionStatus === 'rejected' ? 'Document rejected by parser' : 'File ready from Google Drive',
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
  const [typeMenuAnchor, setTypeMenuAnchor] = useState(null);
  const [reviewerMenuAnchor, setReviewerMenuAnchor] = useState(null);

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
    return {
      all: allDocs.length,
      needsReview: allDocs.filter((d) => (d.needsReview && d.needsReview > 0) || d.status === 'Needs review').length,
      inReview: allDocs.filter((d) => d.status === 'In review').length,
      draft: draftCount,
      indraft: draftCount,
      saved: allDocs.filter((d) => d.status === 'Saved').length,
      reviewed: reviewedCount,
      inreviewed: reviewedCount,
      extracted: allDocs.filter((d) => d.extractionStatus === 'extracted').length,
      warnings: allDocs.filter((d) => d.extractionStatus === 'extracted_with_warnings' || (d.warnings && d.warnings.length > 0)).length,
      rejected: allDocs.filter((d) => d.extractionStatus === 'rejected').length,
      updated: allDocs.filter((d) => d.vectorDbStatus && d.vectorDbStatus.startsWith('Updated')).length,
    };
  }, [allDocs]);

  // Filtered documents
  const filteredDocs = useMemo(() => {
    return allDocs.filter((d) => {
      // Tab filter
      if (activeFilter === 'needs-review' && !(d.needsReview > 0 || d.status === 'Needs review')) return false;
      if (activeFilter === 'extracted' && d.extractionStatus !== 'extracted') return false;
      if (activeFilter === 'warnings' && !(d.extractionStatus === 'extracted_with_warnings' || (d.warnings && d.warnings.length > 0))) return false;
      if (activeFilter === 'rejected' && d.extractionStatus !== 'rejected') return false;
      if (activeFilter === 'updated' && !(d.vectorDbStatus && d.vectorDbStatus.startsWith('Updated'))) return false;

      // Search filter across name, title, parties, reviewer, and folder
      if (activeSearch && activeSearch.trim()) {
        const q = activeSearch.trim().toLowerCase();
        const matchesName = (d.name || '').toLowerCase().includes(q);
        const matchesTitle = d.title ? d.title.toLowerCase().includes(q) : false;
        const matchesParties = d.parties ? d.parties.toLowerCase().includes(q) : false;
        const matchesReviewer = d.reviewer ? d.reviewer.toLowerCase().includes(q) : false;
        const matchesFolder = d.folder ? d.folder.toLowerCase().includes(q) : false;
        if (!matchesName && !matchesTitle && !matchesParties && !matchesReviewer && !matchesFolder) return false;
      }
      return true;
    });
  }, [allDocs, activeFilter, activeSearch]);

  // Handle document row selection
  const handleSelectDoc = (doc) => {
    setSelectedDocId(doc.id || doc.documentId);
    setIsDrawerOpen(true);
  };

  // Extraction Status badge helper
  const renderExtractionBadge = (status, warnings = []) => {
    if (status === 'extracted') {
      return (
        <Chip
          label="• Extracted"
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
    if (status && status.startsWith('Updated')) {
      return (
        <Chip
          label={status}
          size="small"
          sx={{
            height: 22,
            fontSize: '11px',
            fontWeight: 600,
            bgcolor: '#dcfce7',
            color: '#166534',
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
            {driveState.folderPath && (
              <Chip
                label={`📁 ${driveState.folderPath}`}
                size="small"
                sx={{
                  height: 24,
                  fontSize: '11.5px',
                  bgcolor: '#f0fdf4',
                  color: '#166534',
                  border: '1px solid #bbf7d0',
                  fontWeight: 500,
                }}
              />
            )}
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
              { id: 'draft', label: `Draft ${counts.indraft}` },
              { id: 'saved', label: `Saved ${counts.saved}` },
              { id: 'reviewed', label: `Reviewed ${counts.inreviewed}` },
              { id: 'updated', label: `Updated ${counts.updated}` },
              { id: 'rejected', label: `Rejected ${counts.rejected}` },
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

          {/* Dropdown Filters */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button
              size="small"
              endIcon={<KeyboardArrowDownIcon sx={{ fontSize: 14 }} />}
              onClick={(e) => setTypeMenuAnchor(e.currentTarget)}
              sx={{
                height: 28,
                fontSize: '11.5px',
                fontWeight: 500,
                textTransform: 'none',
                px: 1.25,
                bgcolor: '#ffffff',
                color: '#475569',
                border: '1px solid #e2e8f0',
                borderRadius: 1.5,
                '&:hover': { bgcolor: '#f8fafc' },
              }}
            >
              All types
            </Button>
            <Menu
              anchorEl={typeMenuAnchor}
              open={Boolean(typeMenuAnchor)}
              onClose={() => setTypeMenuAnchor(null)}
            >
              <MenuItem onClick={() => setTypeMenuAnchor(null)}>All types</MenuItem>
              <MenuItem onClick={() => setTypeMenuAnchor(null)}>MSA</MenuItem>
              <MenuItem onClick={() => setTypeMenuAnchor(null)}>NDA</MenuItem>
              <MenuItem onClick={() => setTypeMenuAnchor(null)}>SOW</MenuItem>
              <MenuItem onClick={() => setTypeMenuAnchor(null)}>DPA</MenuItem>
              <MenuItem onClick={() => setTypeMenuAnchor(null)}>General</MenuItem>
            </Menu>

            <Button
              size="small"
              endIcon={<KeyboardArrowDownIcon sx={{ fontSize: 14 }} />}
              onClick={(e) => setReviewerMenuAnchor(e.currentTarget)}
              sx={{
                height: 28,
                fontSize: '11.5px',
                fontWeight: 500,
                textTransform: 'none',
                px: 1.25,
                bgcolor: '#ffffff',
                color: '#475569',
                border: '1px solid #e2e8f0',
                borderRadius: 1.5,
                '&:hover': { bgcolor: '#f8fafc' },
              }}
            >
              Any reviewer
            </Button>
            <Menu
              anchorEl={reviewerMenuAnchor}
              open={Boolean(reviewerMenuAnchor)}
              onClose={() => setReviewerMenuAnchor(null)}
            >
              <MenuItem onClick={() => setReviewerMenuAnchor(null)}>Any reviewer</MenuItem>
              <MenuItem onClick={() => setReviewerMenuAnchor(null)}>
                {driveState.user?.name || driveState.user?.email || 'Current Reviewer'}
              </MenuItem>
            </Menu>
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
              {queueCount > 0 ? 'Files are extracting in Your Queue' : 'No documents found in Drive'}
            </Typography>
            <Typography variant="body2" sx={{ color: '#7b838c', maxWidth: 440, lineHeight: 1.5 }}>
              {queueCount > 0
                ? `You have ${queueCount} file${queueCount === 1 ? '' : 's'} currently in Your Queue waiting for extraction or rejected. Once extracted, they will automatically appear here.`
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
                      onDoubleClick={() => onOpenWorkspace && onOpenWorkspace(doc)}
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
                            {/* {reviewerName && (
                              <Chip
                                size="small"
                                label={`Reviewer: ${reviewerName}`}
                                sx={{
                                  height: 20,
                                  fontSize: '11px',
                                  bgcolor: '#f1f5f9',
                                  color: '#475569',
                                  fontWeight: 500,
                                }}
                              />
                            )} */}
                          </Box>
                          <Typography sx={{ fontSize: '11.5px', color: '#64748b', letterSpacing: '0.01em' }}>
                            pages: {doc.pages ?? 0} · clauses: {doc.clauses ?? 0} · paragraphs: {doc.paragraphs ?? 0} · {doc.size}
                          </Typography>
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

          {/* Extraction Status & Needs Review Cards (Replaced Review Progress) */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 1.5,
            }}
          >
            {/* Extraction Status card */}
            <Box
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
            </Box>

            {/* Needs Review card (display count) */}
            <Box
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
            </Box>
          </Box>

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

              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 100 }}>
                  In Drive since
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 500, color: '#0f172a', textAlign: 'right' }}>
                  {selectedDoc.inDriveSince}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 100 }}>
                  Reviewer
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 500, color: '#0f172a', textAlign: 'right' }}>
                  {selectedDoc.reviewer}
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
              onClick={() => onOpenWorkspace && onOpenWorkspace(selectedDoc)}
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
