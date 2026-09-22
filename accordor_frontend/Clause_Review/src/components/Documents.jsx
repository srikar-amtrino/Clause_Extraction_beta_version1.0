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
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import SyncIcon from '@mui/icons-material/Sync';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

export default function Documents({
  documents = [],
  onOpenWorkspace,
  driveState = {},
  onOpenPicker,
  onConnectDrive,
  onCheckDrive,
  isEmptyData = false,
}) {
  // Format real documents from Google Drive
  const allDocs = useMemo(() => {
    if (!documents || documents.length === 0 || isEmptyData) {
      return [];
    }
    return documents.map((d, i) => {
      const paragraphs = d.paragraphs || 0;
      const currentReviewed = d.reviewProgress?.current || 0;
      return {
        id: d.id || `doc-${i}`,
        name: d.name || 'Untitled Document',
        fileName: d.name || 'document.docx',
        docType: d.agreementType || driveState.agreementType || 'General',
        paragraphs: paragraphs,
        pages: d.pages || (d.size ? Math.max(1, Math.round(parseInt(d.size, 10) / 35)) : 1),
        size: d.size || '1.2 MB',
        status: d.status || 'Needs review',
        statusTag: d.statusTag || null,
        reviewProgress: d.reviewProgress || { current: currentReviewed, total: paragraphs },
        vectorDbStatus: d.vectorDbStatus || 'Not sent yet',
        vectorDbDetail: d.vectorDbDetail || 'Not sent yet',
        parties: d.parties || (d.folder || driveState.folderPath ? `Folder: ${d.folder || driveState.folderPath}` : 'Parties to Agreement'),
        inDriveSince: d.modifiedTime || 'Recently',
        reviewer: d.reviewer || driveState.user?.name || driveState.user?.email || 'Reviewer',
        lastSaved: d.modifiedTime || 'Today',
        folder: d.folder || driveState.folderPath || 'Google Drive',
        issues: d.issues || {
          duplicateParaId: 0,
          canonicalTypeMissing: 0,
          paragraphsToReview: paragraphs - currentReviewed,
        },
        recentActivity: d.recentActivity || {
          user: driveState.user?.name || 'System',
          action: 'File ready from Google Drive',
          timestamp: d.modifiedTime || 'Today',
        },
        stats: d.stats || {
          reviewed: currentReviewed,
          edited: 0,
          needsFix: 0,
          untouched: paragraphs - currentReviewed,
        },
        webViewLink: d.webViewLink,
      };
    });
  }, [documents, driveState, isEmptyData]);

  const [activeFilter, setActiveFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [typeMenuAnchor, setTypeMenuAnchor] = useState(null);
  const [reviewerMenuAnchor, setReviewerMenuAnchor] = useState(null);
  const [checkedDocIds, setCheckedDocIds] = useState([]);

  // Derive selected document directly from selectedDocId or default to first document
  const selectedDoc = useMemo(() => {
    if (allDocs.length === 0) return null;
    if (selectedDocId) {
      const found = allDocs.find((d) => d.id === selectedDocId);
      if (found) return found;
    }
    return allDocs[0];
  }, [allDocs, selectedDocId]);

  // Counts for tabs
  const counts = useMemo(() => {
    return {
      all: allDocs.length,
      needsReview: allDocs.filter((d) => d.status === 'Needs review').length,
      inReview: allDocs.filter((d) => d.status === 'In review').length,
      draft: allDocs.filter((d) => d.status === 'Draft').length,
      saved: allDocs.filter((d) => d.status === 'Saved').length,
      reviewed: allDocs.filter((d) => d.status === 'Reviewed').length,
      updated: allDocs.filter((d) => d.status === 'Updated to vector DB').length,
    };
  }, [allDocs]);

  // Filtered documents
  const filteredDocs = useMemo(() => {
    return allDocs.filter((d) => {
      // Tab filter
      if (activeFilter === 'needs-review' && d.status !== 'Needs review') return false;
      if (activeFilter === 'in-review' && d.status !== 'In review') return false;
      if (activeFilter === 'draft' && d.status !== 'Draft') return false;
      if (activeFilter === 'saved' && d.status !== 'Saved') return false;
      if (activeFilter === 'reviewed' && d.status !== 'Reviewed') return false;
      if (activeFilter === 'updated' && d.status !== 'Updated to vector DB') return false;

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = d.name.toLowerCase().includes(q);
        const matchesType = d.docType.toLowerCase().includes(q);
        const matchesParties = d.parties ? d.parties.toLowerCase().includes(q) : false;
        if (!matchesName && !matchesType && !matchesParties) return false;
      }
      return true;
    });
  }, [allDocs, activeFilter, searchQuery]);

  // Handle document row selection
  const handleSelectDoc = (doc) => {
    setSelectedDocId(doc.id);
    setIsDrawerOpen(true);
  };

  const handleToggleCheckAll = (e) => {
    if (e.target.checked) {
      setCheckedDocIds(filteredDocs.map((d) => d.id));
    } else {
      setCheckedDocIds([]);
    }
  };

  const handleToggleCheckRow = (id, e) => {
    e.stopPropagation();
    if (checkedDocIds.includes(id)) {
      setCheckedDocIds(checkedDocIds.filter((item) => item !== id));
    } else {
      setCheckedDocIds([...checkedDocIds, id]);
    }
  };

  // Status Chip helper
  const renderStatusBadge = (status, tag) => {
    let style = { bgcolor: '#f3f4f6', color: '#374151' };
    if (status === 'Draft') style = { bgcolor: '#fef3c7', color: '#92400e' };
    else if (status === 'Needs review') style = { bgcolor: '#f3f4f6', color: '#4b5563' };
    else if (status === 'In review') style = { bgcolor: '#e0f2fe', color: '#0369a1' };
    else if (status === 'Updated to vector DB') style = { bgcolor: '#1e3a5f', color: '#ffffff' };
    else if (status === 'Reviewed') style = { bgcolor: '#dcfce7', color: '#166534' };
    else if (status === 'Saved') style = { bgcolor: '#f3e8ff', color: '#6b21a8' };

    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Chip
          label={`• ${status}`}
          size="small"
          sx={{
            height: 22,
            fontSize: '11px',
            fontWeight: 600,
            ...style,
          }}
        />
        {tag && (
          <Chip
            label={tag}
            size="small"
            sx={{
              height: 22,
              fontSize: '11px',
              fontWeight: 600,
              bgcolor: '#fee2e2',
              color: '#b91c1c',
            }}
          />
        )}
      </Box>
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
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
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
              { id: 'draft', label: `Draft ${counts.draft}` },
              { id: 'saved', label: `Saved ${counts.saved}` },
              { id: 'reviewed', label: `Reviewed ${counts.reviewed}` },
              { id: 'updated', label: `Updated ${counts.updated}` },
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
              No documents found in Drive
            </Typography>
            <Typography variant="body2" sx={{ color: '#7b838c', maxWidth: 420, lineHeight: 1.5 }}>
              {driveState.isConnected
                ? driveState.folderPath
                  ? `No files found in folder "${driveState.folderPath}". Please upload DOCX or PDF files into this folder or click Sync files.`
                  : 'Connected to Google Drive. Choose a folder from the Overview section to load contracts.'
                : 'Connect your Google Drive account from the Overview section to load real contracts for review.'}
            </Typography>
            {driveState.isConnected ? (
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
                  <TableCell padding="checkbox" sx={{ bgcolor: '#f8fafc', py: 1.25, borderBottom: '1px solid #e2e8f0', width: 44 }}>
                    <Checkbox
                      size="small"
                      indeterminate={checkedDocIds.length > 0 && checkedDocIds.length < filteredDocs.length}
                      checked={filteredDocs.length > 0 && checkedDocIds.length === filteredDocs.length}
                      onChange={handleToggleCheckAll}
                      sx={{ p: 0.5 }}
                    />
                  </TableCell>
                  <TableCell sx={{ bgcolor: '#f8fafc', py: 1.25, fontSize: '12px', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                    Document
                  </TableCell>
                  <TableCell sx={{ bgcolor: '#f8fafc', py: 1.25, fontSize: '12px', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0', width: 180 }}>
                    Status
                  </TableCell>
                  <TableCell sx={{ bgcolor: '#f8fafc', py: 1.25, fontSize: '12px', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0', width: 170 }}>
                    Review progress
                  </TableCell>
                  <TableCell sx={{ bgcolor: '#f8fafc', py: 1.25, fontSize: '12px', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0', width: 160 }}>
                    Vector DB
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredDocs.map((doc) => {
                  const isSelected = selectedDoc?.id === doc.id;
                  const isChecked = checkedDocIds.includes(doc.id);
                  const total = doc.reviewProgress?.total || 0;
                  const current = doc.reviewProgress?.current || 0;
                  const progressVal = total > 0 ? Math.round((current / total) * 100) : 0;

                  return (
                    <TableRow
                      key={doc.id}
                      hover
                      onClick={() => handleSelectDoc(doc)}
                      sx={{
                        cursor: 'pointer',
                        bgcolor: isSelected ? '#f8fafc' : '#ffffff',
                        borderLeft: isSelected ? '3px solid #1e3a5f' : '3px solid transparent',
                        '&:hover': { bgcolor: isSelected ? '#f1f5f9' : '#f8fafc' },
                      }}
                    >
                      {/* Checkbox */}
                      <TableCell padding="checkbox" sx={{ py: 1.25 }}>
                        <Checkbox
                          size="small"
                          checked={isChecked}
                          onClick={(e) => handleToggleCheckRow(doc.id, e)}
                          sx={{ p: 0.5 }}
                        />
                      </TableCell>

                      {/* Document Info */}
                      <TableCell sx={{ py: 1.25 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          {/* DOCX Icon badge */}
                          <Box
                            sx={{
                              width: 28,
                              height: 32,
                              border: '1px solid #cbd5e1',
                              borderRadius: 1,
                              bgcolor: '#f8fafc',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            <Typography sx={{ fontSize: '9px', fontWeight: 700, color: '#0284c7' }}>
                              DOCX
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                              <Typography
                                sx={{
                                  fontSize: '13px',
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
                              {doc.webViewLink && (
                                <Tooltip title="Open in Google Drive" arrow>
                                  <IconButton
                                    size="small"
                                    component="a"
                                    href={doc.webViewLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    sx={{ p: 0.2, color: '#94a3b8', '&:hover': { color: '#0284c7' } }}
                                  >
                                    <OpenInNewIcon sx={{ fontSize: 13 }} />
                                  </IconButton>
                                </Tooltip>
                              )}
                            </Box>
                            <Typography sx={{ fontSize: '11.5px', color: '#64748b' }}>
                              {doc.docType} · {doc.paragraphs > 0 ? `${doc.paragraphs} paragraphs · ` : ''}{doc.size}
                            </Typography>
                          </Box>
                        </Box>
                      </TableCell>

                      {/* Status */}
                      <TableCell sx={{ py: 1.25 }}>
                        {renderStatusBadge(doc.status, doc.statusTag)}
                      </TableCell>

                      {/* Review progress */}
                      <TableCell sx={{ py: 1.25 }}>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, pr: 2 }}>
                          <Typography sx={{ fontSize: '11.5px', fontWeight: 600, color: '#475569' }}>
                            {current} / {total}
                          </Typography>
                          <LinearProgress
                            variant="determinate"
                            value={progressVal}
                            sx={{
                              height: 4,
                              borderRadius: 2,
                              bgcolor: '#e2e8f0',
                              '& .MuiLinearProgress-bar': {
                                bgcolor: progressVal > 0 ? '#15803d' : 'transparent',
                                borderRadius: 2,
                              },
                            }}
                          />
                        </Box>
                      </TableCell>

                      {/* Vector DB */}
                      <TableCell sx={{ py: 1.25 }}>
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
          {/* Header with DOCX icon, Title, Meta and Close button */}
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
            <Box sx={{ display: 'flex', gap: 1.5, minWidth: 0 }}>
              <Box
                sx={{
                  width: 32,
                  height: 38,
                  border: '1px solid #cbd5e1',
                  borderRadius: 1,
                  bgcolor: '#f8fafc',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  mt: 0.25,
                }}
              >
                <Typography sx={{ fontSize: '9px', fontWeight: 700, color: '#0284c7' }}>
                  DOCX
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 }}>
                <Typography
                  sx={{
                    fontSize: '14.5px',
                    fontWeight: 700,
                    color: '#0f172a',
                    lineHeight: 1.3,
                    wordBreak: 'break-word',
                  }}
                >
                  {selectedDoc.name}
                </Typography>
                <Typography sx={{ fontSize: '11.5px', color: '#64748b' }}>
                  {selectedDoc.fileName} · {selectedDoc.pages} pages · {selectedDoc.size}
                </Typography>
              </Box>
            </Box>

            <IconButton
              size="small"
              onClick={() => setIsDrawerOpen(false)}
              sx={{ color: '#94a3b8', p: 0.5, '&:hover': { color: '#0f172a' }, flexShrink: 0 }}
            >
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>

          {/* Status Badges Row */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Chip
              label={`• ${selectedDoc.status}`}
              size="small"
              sx={{
                height: 22,
                fontSize: '11px',
                fontWeight: 600,
                bgcolor: '#fef3c7',
                color: '#92400e',
              }}
            />
            {selectedDoc.vectorDbStatus === 'Needs re-update' && (
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
            )}
          </Box>

          {/* Review Progress Section */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography sx={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
              Review progress
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={{ flex: 1 }}>
                <LinearProgress
                  variant="determinate"
                  value={
                    selectedDoc.reviewProgress?.total > 0
                      ? Math.round(
                          ((selectedDoc.reviewProgress?.current || 0) /
                            selectedDoc.reviewProgress.total) *
                            100
                        )
                      : 0
                  }
                  sx={{
                    height: 5,
                    borderRadius: 3,
                    bgcolor: '#e2e8f0',
                    '& .MuiLinearProgress-bar': {
                      bgcolor: '#15803d',
                      borderRadius: 3,
                    },
                  }}
                />
              </Box>
              <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                {selectedDoc.reviewProgress?.current || 0} / {selectedDoc.reviewProgress?.total || 0}
              </Typography>
            </Box>
          </Box>

          {/* Alert box: Before this can be updated */}
          <Box
            sx={{
              p: 2,
              bgcolor: '#fef2f2',
              borderRadius: 2,
              border: '1px solid #fecaca',
              display: 'flex',
              flexDirection: 'column',
              gap: 1.5,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <WarningAmberRoundedIcon sx={{ color: '#b91c1c', fontSize: 18 }} />
              <Typography sx={{ fontSize: '12.5px', fontWeight: 700, color: '#991b1b' }}>
                Before this can be updated
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 0.75, borderBottom: '1px solid #fee2e2' }}>
                <Typography sx={{ fontSize: '12px', color: '#7f1d1d' }}>
                  Duplicate paragraph ID
                </Typography>
                <Typography sx={{ fontSize: '12.5px', fontWeight: 700, color: '#7f1d1d' }}>
                  {selectedDoc.issues?.duplicateParaId ?? 0}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 0.75, borderBottom: '1px solid #fee2e2' }}>
                <Typography sx={{ fontSize: '12px', color: '#7f1d1d' }}>
                  Canonical type missing
                </Typography>
                <Typography sx={{ fontSize: '12.5px', fontWeight: 700, color: '#7f1d1d' }}>
                  {selectedDoc.issues?.canonicalTypeMissing ?? 0}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography sx={{ fontSize: '12px', color: '#7f1d1d' }}>
                  Paragraphs still to review
                </Typography>
                <Typography sx={{ fontSize: '12.5px', fontWeight: 700, color: '#7f1d1d' }}>
                  {selectedDoc.issues?.paragraphsToReview ?? selectedDoc.paragraphs ?? 0}
                </Typography>
              </Box>
            </Box>
          </Box>

          {/* Details Section */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography sx={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
              Details
            </Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 90 }}>
                  Parties
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 500, color: '#0f172a', textAlign: 'right' }}>
                  {selectedDoc.parties}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 90 }}>
                  Document type
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 500, color: '#0f172a', textAlign: 'right' }}>
                  {selectedDoc.docType}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 90 }}>
                  Paragraphs
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 500, color: '#0f172a', textAlign: 'right' }}>
                  {selectedDoc.paragraphs}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 90 }}>
                  In Drive since
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 500, color: '#0f172a', textAlign: 'right' }}>
                  {selectedDoc.inDriveSince}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 90 }}>
                  Reviewer
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 500, color: '#0f172a', textAlign: 'right' }}>
                  {selectedDoc.reviewer}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 90 }}>
                  Last saved
                </Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 500, color: '#0f172a', textAlign: 'right' }}>
                  {selectedDoc.lastSaved}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#64748b', minWidth: 90 }}>
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
