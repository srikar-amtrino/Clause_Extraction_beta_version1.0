import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Chip,
  IconButton,
  TextField,
  InputAdornment,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Checkbox,
  LinearProgress,
  Tooltip,
  Menu,
  MenuItem,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import UndoOutlinedIcon from '@mui/icons-material/UndoOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import SearchIcon from '@mui/icons-material/Search';
import ViewColumnOutlinedIcon from '@mui/icons-material/ViewColumnOutlined';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import HistoryIcon from '@mui/icons-material/History';
import NoteAltOutlinedIcon from '@mui/icons-material/NoteAltOutlined';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import AddIcon from '@mui/icons-material/Add';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';

export default function ReviewWorkspace({
  document: doc,
  onBackToDocuments,
  showToast,
}) {
  const [activeTab, setActiveTab] = useState('review');
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRows, setSelectedRows] = useState([]);
  const [templateTypeMenuAnchor, setTemplateTypeMenuAnchor] = useState(null);
  const [extractedClauses, setExtractedClauses] = useState(doc?.clauses || []);

  if (!doc) {
    return (
      <Box sx={{ p: 4, textAlign: 'center', bgcolor: '#ffffff', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <DescriptionOutlinedIcon sx={{ fontSize: 48, color: '#94a3b8', mb: 1.5 }} />
        <Typography variant="h6" sx={{ color: '#1b1f24', fontWeight: 600 }}>No document selected</Typography>
        <Typography variant="body2" sx={{ color: '#64748b', mt: 0.5, mb: 2.5 }}>
          Select a document from your Google Drive files to view its review workspace template.
        </Typography>
        <Button onClick={onBackToDocuments} variant="contained" sx={{ bgcolor: '#1e3a5f', textTransform: 'none' }}>
          Back to Documents
        </Button>
      </Box>
    );
  }

  const totalParas = doc.paragraphs || extractedClauses.length || 0;
  const reviewedCount = doc.reviewProgress?.current || 0;
  const progressPercent = totalParas > 0 ? Math.round((reviewedCount / totalParas) * 100) : 0;

  // Status badge styling helper
  const getStatusBadgeStyle = (status) => {
    switch (status) {
      case 'Draft':
        return { bgcolor: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' };
      case 'Needs review':
        return { bgcolor: '#f3f4f6', color: '#4b5563', border: '1px solid #e5e7eb' };
      case 'In review':
        return { bgcolor: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' };
      case 'Updated to vector DB':
        return { bgcolor: '#e0e7ff', color: '#3730a3', border: '1px solid #c7d2fe' };
      case 'Reviewed':
        return { bgcolor: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' };
      case 'Saved':
        return { bgcolor: '#f3e8ff', color: '#6b21a8', border: '1px solid #e9d5ff' };
      default:
        return { bgcolor: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' };
    }
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedRows(extractedClauses.map((_, i) => i));
    } else {
      setSelectedRows([]);
    }
  };

  const handleToggleRow = (index) => {
    if (selectedRows.includes(index)) {
      setSelectedRows(selectedRows.filter((i) => i !== index));
    } else {
      setSelectedRows([...selectedRows, index]);
    }
  };

  const handleExtractClauses = () => {
    showToast?.(`Initiating clause extraction for ${doc.name}...`);
  };

  const handleAddEmptyClause = () => {
    const nextIndex = extractedClauses.length + 1;
    const newClause = {
      paraId: `P-${String(nextIndex).padStart(3, '0')}`,
      breadcrumb: `Clause ${nextIndex}\nUnclassified`,
      text: '',
      label: 'Clause',
      canonicalType: 'Unassigned',
      subType: 'null',
    };
    setExtractedClauses([...extractedClauses, newClause]);
    showToast?.(`Added new clause template slot P-${String(nextIndex).padStart(3, '0')}`);
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        bgcolor: '#ffffff',
        overflow: 'hidden',
      }}
    >
      {/* 1. TOP BREADCRUMB & HEADER SECTION */}
      <Box
        sx={{
          px: { xs: 2, sm: 3 },
          pt: 1.75,
          pb: 1.5,
          borderBottom: '1px solid #e3e3de',
          bgcolor: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25,
        }}
      >
        {/* Breadcrumb row */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '12px', color: '#7b838c' }}>
          <Box
            component="button"
            onClick={onBackToDocuments}
            sx={{
              background: 'none',
              border: 'none',
              p: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              color: '#1e3a5f',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            <ArrowBackIcon sx={{ fontSize: 14 }} />
            Documents
          </Box>
          <span>›</span>
          <span>{doc.folder || 'Google Drive'}</span>
          <span>›</span>
          <Typography sx={{ fontSize: '12px', color: '#1b1f24', fontWeight: 500 }}>
            {doc.name}
          </Typography>
        </Box>

        {/* Title & Actions Row */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 2,
          }}
        >
          {/* Document Title, Status, Progress */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Typography
                variant="h6"
                sx={{
                  fontWeight: 700,
                  fontSize: '17px',
                  color: '#1b1f24',
                  letterSpacing: '-0.01em',
                }}
              >
                {doc.name}
              </Typography>
              <IconButton size="small" sx={{ p: 0.25, color: '#7b838c' }}>
                <KeyboardArrowDownIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>

            {/* Status chip */}
            <Chip
              label={`• ${doc.status}`}
              size="small"
              sx={{
                height: 22,
                fontSize: '11.5px',
                fontWeight: 600,
                ...getStatusBadgeStyle(doc.status),
              }}
            />

            {/* Mini Progress */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 1 }}>
              <Typography sx={{ fontSize: '12.5px', fontWeight: 700, color: '#1b1f24' }}>
                {reviewedCount} / {totalParas}
              </Typography>
              <Box sx={{ width: 64 }}>
                <LinearProgress
                  variant="determinate"
                  value={progressPercent}
                  sx={{
                    height: 5,
                    borderRadius: 3,
                    bgcolor: '#e5e7eb',
                    '& .MuiLinearProgress-bar': {
                      bgcolor: '#15803d',
                      borderRadius: 3,
                    },
                  }}
                />
              </Box>
            </Box>
          </Box>

          {/* Right Top Actions */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: '#7b838c', fontSize: '12px' }}>
              <EditOutlinedIcon sx={{ fontSize: 14 }} />
              <span>Saved {doc.lastSaved || 'Today'}</span>
            </Box>

            <Tooltip title="Undo changes">
              <IconButton
                size="small"
                onClick={() => showToast?.('Undo action triggered')}
                sx={{
                  border: '1px solid #e3e3de',
                  borderRadius: 1.25,
                  p: 0.6,
                  color: '#4a5159',
                  '&:hover': { bgcolor: '#f5f5f2' },
                }}
              >
                <UndoOutlinedIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>

            <Button
              variant="outlined"
              size="small"
              startIcon={<SaveOutlinedIcon sx={{ fontSize: 15 }} />}
              onClick={() => showToast?.(`Saved changes for ${doc.name}`)}
              sx={{
                height: 32,
                fontSize: '12px',
                fontWeight: 600,
                textTransform: 'none',
                borderColor: '#cfcfc8',
                color: '#1b1f24',
                bgcolor: '#ffffff',
                borderRadius: 1.25,
                '&:hover': { bgcolor: '#f5f5f2', borderColor: '#1e3a5f' },
              }}
            >
              Save
            </Button>

            <Button
              variant="contained"
              size="small"
              startIcon={<CloudUploadOutlinedIcon sx={{ fontSize: 16 }} />}
              onClick={() => showToast?.(`Updating "${doc.name}" to vector database...`)}
              sx={{
                height: 32,
                fontSize: '12px',
                fontWeight: 600,
                textTransform: 'none',
                bgcolor: '#1e3a5f',
                color: '#ffffff',
                borderRadius: 1.25,
                px: 1.75,
                boxShadow: 'none',
                '&:hover': { bgcolor: '#152943', boxShadow: 'none' },
              }}
            >
              Update to vector DB
            </Button>
          </Box>
        </Box>

        {/* Subheader info & counts row */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 1.5,
            pt: 0.5,
            fontSize: '12px',
            color: '#7b838c',
          }}
        >
          {/* Real file details */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <span>{totalParas} paragraphs</span>
            <span>|</span>
            <span>{doc.fileName} · {doc.size}</span>
            <span>|</span>
            <span>In Drive since {doc.inDriveSince || 'Recently'}</span>
            <span>|</span>
            <span>Reviewer <strong style={{ color: '#1b1f24' }}>{doc.reviewer || 'Reviewer'}</strong></span>
          </Box>

          {/* Status color count pills */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, fontSize: '11.5px', color: '#374151' }}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#16a34a' }} />
              <span>Reviewed {doc.stats?.reviewed ?? reviewedCount}</span>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, fontSize: '11.5px', color: '#374151' }}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#7c3aed' }} />
              <span>Edited {doc.stats?.edited ?? 0}</span>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, fontSize: '11.5px', color: '#374151' }}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#dc2626' }} />
              <span>Needs a fix {doc.stats?.needsFix ?? 0}</span>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, fontSize: '11.5px', color: '#374151' }}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#9ca3af' }} />
              <span>Untouched {doc.stats?.untouched ?? totalParas}</span>
            </Box>
          </Box>
        </Box>
      </Box>

      {/* 2. TABS & WORKSPACE TOOLBAR */}
      <Box
        sx={{
          px: { xs: 2, sm: 3 },
          pt: 1,
          pb: 1,
          borderBottom: '1px solid #e3e3de',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1.5,
          bgcolor: '#ffffff',
        }}
      >
        {/* Navigation Tabs */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box
            onClick={() => setActiveTab('review')}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              pb: 0.75,
              pt: 0.25,
              borderBottom: activeTab === 'review' ? '2px solid #1e3a5f' : '2px solid transparent',
              color: activeTab === 'review' ? '#1e3a5f' : '#7b838c',
              fontWeight: activeTab === 'review' ? 600 : 500,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            <CheckCircleOutlinedIcon sx={{ fontSize: 16 }} />
            <span>Review</span>
          </Box>

          <Box
            onClick={() => setActiveTab('history')}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              pb: 0.75,
              pt: 0.25,
              borderBottom: activeTab === 'history' ? '2px solid #1e3a5f' : '2px solid transparent',
              color: activeTab === 'history' ? '#1e3a5f' : '#7b838c',
              fontWeight: activeTab === 'history' ? 600 : 500,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            <HistoryIcon sx={{ fontSize: 16 }} />
            <span>History</span>
            <Chip label="0" size="small" sx={{ height: 18, fontSize: '10.5px', bgcolor: '#f3f4f6', color: '#4b5563' }} />
          </Box>

          <Box
            onClick={() => setActiveTab('note')}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              pb: 0.75,
              pt: 0.25,
              borderBottom: activeTab === 'note' ? '2px solid #1e3a5f' : '2px solid transparent',
              color: activeTab === 'note' ? '#1e3a5f' : '#7b838c',
              fontWeight: activeTab === 'note' ? 600 : 500,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            <NoteAltOutlinedIcon sx={{ fontSize: 16 }} />
            <span>Document note</span>
          </Box>
        </Box>

        {/* Action Buttons: Add Clause & Extract Clauses */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button
            size="small"
            startIcon={<AddIcon sx={{ fontSize: 15 }} />}
            onClick={handleAddEmptyClause}
            sx={{
              height: 28,
              fontSize: '11.5px',
              fontWeight: 500,
              textTransform: 'none',
              px: 1.25,
              bgcolor: '#ffffff',
              color: '#1e3a5f',
              border: '1px solid #cfcfc8',
              borderRadius: 1.5,
              '&:hover': { bgcolor: '#f5f5f2', borderColor: '#1e3a5f' },
            }}
          >
            Add clause slot
          </Button>

          <Button
            size="small"
            startIcon={<AutoAwesomeOutlinedIcon sx={{ fontSize: 14 }} />}
            onClick={handleExtractClauses}
            sx={{
              height: 28,
              fontSize: '11.5px',
              fontWeight: 600,
              textTransform: 'none',
              px: 1.25,
              bgcolor: '#1e3a5f',
              color: '#ffffff',
              borderRadius: 1.5,
              '&:hover': { bgcolor: '#152943' },
            }}
          >
            Extract clauses
          </Button>
        </Box>
      </Box>

      {/* 3. SEARCH & FILTER TOOLBAR */}
      <Box
        sx={{
          px: { xs: 2, sm: 3 },
          py: 1.25,
          bgcolor: '#fafaf8',
          borderBottom: '1px solid #e3e3de',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1.5,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
          {/* Find in document */}
          <TextField
            size="small"
            placeholder="Find in this document..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            sx={{
              width: { xs: 180, sm: 220 },
              '& .MuiOutlinedInput-root': {
                height: 32,
                fontSize: '12px',
                bgcolor: '#ffffff',
                borderRadius: 1.5,
                '& fieldset': { borderColor: '#cfcfc8' },
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

          {/* Filter Pills */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            {[
              { id: 'all', label: `All ${extractedClauses.length}` },
              { id: 'to-review', label: 'To review' },
              { id: 'needs-fix', label: 'Needs a fix' },
              { id: 'edited', label: 'Edited' },
              { id: 'low-conf', label: 'Low confidence' },
            ].map((f) => (
              <Button
                key={f.id}
                size="small"
                onClick={() => setActiveFilter(f.id)}
                sx={{
                  height: 28,
                  fontSize: '11.5px',
                  fontWeight: activeFilter === f.id ? 600 : 500,
                  textTransform: 'none',
                  px: 1.25,
                  borderRadius: 1.5,
                  bgcolor: activeFilter === f.id ? '#1e3a5f' : '#ffffff',
                  color: activeFilter === f.id ? '#ffffff' : '#4a5159',
                  border: '1px solid',
                  borderColor: activeFilter === f.id ? '#1e3a5f' : '#cfcfc8',
                  '&:hover': {
                    bgcolor: activeFilter === f.id ? '#152943' : '#f5f5f2',
                  },
                }}
              >
                {f.label}
              </Button>
            ))}

            {/* All types dropdown button */}
            <Button
              size="small"
              endIcon={<KeyboardArrowDownIcon sx={{ fontSize: 14 }} />}
              onClick={(e) => setTemplateTypeMenuAnchor(e.currentTarget)}
              sx={{
                height: 28,
                fontSize: '11.5px',
                fontWeight: 500,
                textTransform: 'none',
                px: 1.25,
                bgcolor: '#ffffff',
                color: '#4a5159',
                border: '1px solid #cfcfc8',
                borderRadius: 1.5,
                '&:hover': { bgcolor: '#f5f5f2' },
              }}
            >
              All types
            </Button>
            <Menu
              anchorEl={templateTypeMenuAnchor}
              open={Boolean(templateTypeMenuAnchor)}
              onClose={() => setTemplateTypeMenuAnchor(null)}
              slotProps={{ paper: { sx: { fontSize: '12px', minWidth: 140 } } }}
            >
              <MenuItem onClick={() => setTemplateTypeMenuAnchor(null)}>All types</MenuItem>
              <MenuItem onClick={() => setTemplateTypeMenuAnchor(null)}>Clauses only</MenuItem>
              <MenuItem onClick={() => setTemplateTypeMenuAnchor(null)}>Non-clause</MenuItem>
            </Menu>
          </Box>
        </Box>

        {/* Right Buttons: Columns & Source document */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button
            size="small"
            startIcon={<ViewColumnOutlinedIcon sx={{ fontSize: 16 }} />}
            onClick={() => showToast?.('Column layout settings')}
            sx={{
              height: 28,
              fontSize: '11.5px',
              fontWeight: 500,
              textTransform: 'none',
              bgcolor: '#ffffff',
              color: '#4a5159',
              border: '1px solid #cfcfc8',
              borderRadius: 1.5,
              '&:hover': { bgcolor: '#f5f5f2' },
            }}
          >
            Columns
          </Button>

          <Button
            size="small"
            startIcon={<ArticleOutlinedIcon sx={{ fontSize: 16 }} />}
            onClick={() => {
              if (doc.webViewLink) {
                window.open(doc.webViewLink, '_blank');
              } else {
                showToast?.(`Opening source document view for ${doc.fileName}`);
              }
            }}
            sx={{
              height: 28,
              fontSize: '11.5px',
              fontWeight: 500,
              textTransform: 'none',
              bgcolor: '#ffffff',
              color: '#4a5159',
              border: '1px solid #cfcfc8',
              borderRadius: 1.5,
              '&:hover': { bgcolor: '#f5f5f2' },
            }}
          >
            Source document
          </Button>
        </Box>
      </Box>

      {/* 4. MAIN CLAUSE REVIEW TEMPLATE TABLE */}
      <Box sx={{ flex: 1, overflowY: 'auto', bgcolor: '#ffffff' }}>
        <TableContainer sx={{ width: '100%', height: '100%' }}>
          <Table stickyHeader size="small" sx={{ minWidth: 960 }}>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" sx={{ bgcolor: '#fafaf8', py: 1, borderBottom: '1px solid #e3e3de' }}>
                  <Checkbox
                    size="small"
                    indeterminate={selectedRows.length > 0 && selectedRows.length < extractedClauses.length}
                    checked={extractedClauses.length > 0 && selectedRows.length === extractedClauses.length}
                    onChange={handleSelectAll}
                    disabled={extractedClauses.length === 0}
                    sx={{ p: 0.5 }}
                  />
                </TableCell>
                <TableCell sx={{ bgcolor: '#fafaf8', py: 1, fontSize: '11.5px', fontWeight: 600, color: '#7b838c', borderBottom: '1px solid #e3e3de', width: 90 }}>
                  Para ID
                </TableCell>
                <TableCell sx={{ bgcolor: '#fafaf8', py: 1, fontSize: '11.5px', fontWeight: 600, color: '#7b838c', borderBottom: '1px solid #e3e3de', width: 140 }}>
                  Breadcrumb
                </TableCell>
                <TableCell sx={{ bgcolor: '#fafaf8', py: 1, fontSize: '11.5px', fontWeight: 600, color: '#7b838c', borderBottom: '1px solid #e3e3de' }}>
                  Text Information
                </TableCell>
                <TableCell sx={{ bgcolor: '#fafaf8', py: 1, fontSize: '11.5px', fontWeight: 600, color: '#7b838c', borderBottom: '1px solid #e3e3de', width: 110 }}>
                  Label
                </TableCell>
                <TableCell sx={{ bgcolor: '#fafaf8', py: 1, fontSize: '11.5px', fontWeight: 600, color: '#7b838c', borderBottom: '1px solid #e3e3de', width: 140 }}>
                  Canonical type
                </TableCell>
                <TableCell sx={{ bgcolor: '#fafaf8', py: 1, fontSize: '11.5px', fontWeight: 600, color: '#7b838c', borderBottom: '1px solid #e3e3de', width: 120 }}>
                  Sub-type
                </TableCell>
                <TableCell align="center" sx={{ bgcolor: '#fafaf8', py: 1, fontSize: '11.5px', fontWeight: 600, color: '#7b838c', borderBottom: '1px solid #e3e3de', width: 70 }}>
                  Preview
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {extractedClauses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} sx={{ py: 6, textAlign: 'center' }}>
                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 1.5,
                        maxWidth: 440,
                        mx: 'auto',
                      }}
                    >
                      <Box
                        sx={{
                          width: 48,
                          height: 48,
                          borderRadius: '50%',
                          bgcolor: '#f1f5f9',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#64748b',
                        }}
                      >
                        <DescriptionOutlinedIcon sx={{ fontSize: 24 }} />
                      </Box>
                      <Typography sx={{ fontSize: '14px', fontWeight: 600, color: '#1e293b' }}>
                        Clause template ready for {doc.name}
                      </Typography>
                      <Typography sx={{ fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                        No clauses extracted yet for this document. Click "Extract clauses" to run clause classification, or click "Add clause slot" to enter clauses manually.
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 1.5, mt: 1 }}>
                        <Button
                          variant="contained"
                          size="small"
                          startIcon={<AutoAwesomeOutlinedIcon sx={{ fontSize: 15 }} />}
                          onClick={handleExtractClauses}
                          sx={{ bgcolor: '#1e3a5f', textTransform: 'none', fontWeight: 600, fontSize: '12px' }}
                        >
                          Extract clauses
                        </Button>
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={<AddIcon sx={{ fontSize: 15 }} />}
                          onClick={handleAddEmptyClause}
                          sx={{ borderColor: '#cfcfc8', color: '#1b1f24', textTransform: 'none', fontWeight: 600, fontSize: '12px' }}
                        >
                          Add clause slot
                        </Button>
                      </Box>
                    </Box>
                  </TableCell>
                </TableRow>
              ) : (
                extractedClauses.map((row, idx) => {
                  const isSelected = selectedRows.includes(idx);
                  return (
                    <TableRow
                      key={row.paraId || idx}
                      hover
                      selected={isSelected}
                      sx={{
                        cursor: 'pointer',
                        borderLeft: idx === 0 ? '3px solid #0284c7' : '3px solid transparent',
                        bgcolor: idx === 0 ? '#f8fafc' : isSelected ? '#f1f5f9' : '#ffffff',
                        '&:hover': { bgcolor: '#f8fafc' },
                      }}
                    >
                      <TableCell padding="checkbox" sx={{ py: 1 }}>
                        <Checkbox
                          size="small"
                          checked={isSelected}
                          onChange={() => handleToggleRow(idx)}
                          sx={{ p: 0.5 }}
                        />
                      </TableCell>

                      {/* Para ID with bullet circle */}
                      <TableCell sx={{ py: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box
                            sx={{
                              width: 10,
                              height: 10,
                              borderRadius: '50%',
                              bgcolor: idx === 0 ? '#15803d' : '#22c55e',
                              flexShrink: 0,
                            }}
                          />
                          <Typography sx={{ fontSize: '12px', fontWeight: 600, color: '#1e293b' }}>
                            {row.paraId}
                          </Typography>
                        </Box>
                      </TableCell>

                      {/* Breadcrumb */}
                      <TableCell sx={{ py: 1 }}>
                        <Typography sx={{ fontSize: '11.5px', fontWeight: 600, color: '#1e293b', lineHeight: 1.2 }}>
                          {row.breadcrumb.split('\n')[0]}
                        </Typography>
                        {row.breadcrumb.split('\n')[1] && (
                          <Typography sx={{ fontSize: '10.5px', color: '#64748b', lineHeight: 1.2 }}>
                            {row.breadcrumb.split('\n')[1]}
                          </Typography>
                        )}
                      </TableCell>

                      {/* Text Information */}
                      <TableCell sx={{ py: 1 }}>
                        <Typography
                          sx={{
                            fontSize: '12px',
                            color: row.text ? '#1e293b' : '#94a3b8',
                            fontStyle: row.text ? 'normal' : 'italic',
                            lineHeight: 1.45,
                            maxWidth: { xs: 300, sm: 480, md: 620 },
                          }}
                        >
                          {row.text || '[Empty clause text — type or paste clause text here]'}
                        </Typography>
                      </TableCell>

                      {/* Label */}
                      <TableCell sx={{ py: 1 }}>
                        <Chip
                          label={row.label}
                          size="small"
                          sx={{
                            height: 22,
                            fontSize: '11px',
                            fontWeight: 500,
                            bgcolor: row.label === 'Clause' ? '#eff6ff' : '#f8fafc',
                            color: row.label === 'Clause' ? '#1d4ed8' : '#64748b',
                            border: '1px solid',
                            borderColor: row.label === 'Clause' ? '#bfdbfe' : '#e2e8f0',
                          }}
                        />
                      </TableCell>

                      {/* Canonical Type */}
                      <TableCell sx={{ py: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Typography sx={{ fontSize: '12px', color: row.canonicalType === 'Unassigned' ? '#94a3b8' : '#1e293b' }}>
                            {row.canonicalType}
                          </Typography>
                          <KeyboardArrowDownIcon sx={{ fontSize: 14, color: '#94a3b8' }} />
                        </Box>
                      </TableCell>

                      {/* Sub-type */}
                      <TableCell sx={{ py: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Typography sx={{ fontSize: '12px', color: row.subType === 'null' ? '#94a3b8' : '#1e293b' }}>
                            {row.subType}
                          </Typography>
                          <KeyboardArrowDownIcon sx={{ fontSize: 14, color: '#94a3b8' }} />
                        </Box>
                      </TableCell>

                      {/* Preview eye icon */}
                      <TableCell align="center" sx={{ py: 1 }}>
                        <IconButton size="small" sx={{ p: 0.25, color: '#94a3b8', '&:hover': { color: '#0284c7' } }}>
                          <VisibilityOutlinedIcon sx={{ fontSize: 15 }} />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

      {/* 5. FOOTER STATUS BAR WITH SHORTCUTS */}
      <Box
        sx={{
          height: 36,
          minHeight: 36,
          bgcolor: '#fafaf8',
          borderTop: '1px solid #e3e3de',
          px: { xs: 2, sm: 3 },
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '11.5px',
          color: '#64748b',
          userSelect: 'none',
        }}
      >
        {/* Left: row selection info */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <span>{selectedRows.length > 0 ? `${selectedRows.length} row(s) selected` : 'No rows selected'}</span>
          <span>|</span>
          <span style={{ color: '#0f172a', fontWeight: 500 }}>
            {doc.name}
          </span>
        </Box>

        {/* Right: Keyboard shortcuts */}
        <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 1.75 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box component="span" sx={{ px: 0.6, py: 0.1, bgcolor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 0.75, fontSize: '10px', fontWeight: 600, color: '#334155' }}>
              J
            </Box>
            <Box component="span" sx={{ px: 0.6, py: 0.1, bgcolor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 0.75, fontSize: '10px', fontWeight: 600, color: '#334155' }}>
              K
            </Box>
            <span>move</span>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box component="span" sx={{ px: 0.6, py: 0.1, bgcolor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 0.75, fontSize: '10px', fontWeight: 600, color: '#334155' }}>
              R
            </Box>
            <span>reviewed</span>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box component="span" sx={{ px: 0.6, py: 0.1, bgcolor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 0.75, fontSize: '10px', fontWeight: 600, color: '#334155' }}>
              E
            </Box>
            <span>edit</span>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box component="span" sx={{ px: 0.6, py: 0.1, bgcolor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 0.75, fontSize: '10px', fontWeight: 600, color: '#334155' }}>
              S
            </Box>
            <span>source</span>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box component="span" sx={{ px: 0.6, py: 0.1, bgcolor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 0.75, fontSize: '10px', fontWeight: 600, color: '#334155' }}>
              Ctrl+S
            </Box>
            <span>save</span>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
