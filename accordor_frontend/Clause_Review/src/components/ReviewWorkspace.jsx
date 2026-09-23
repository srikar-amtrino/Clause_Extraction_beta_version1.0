import React, { useState, useEffect } from 'react';
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
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import { documentService } from '../services/documentService';
import { useAuth } from '../context/AuthContext';

export default function ReviewWorkspace({
  document: doc,
  onBackToDocuments,
  showToast,
}) {
  const { currentUser } = useAuth();
  const currentUserName = currentUser?.username || currentUser?.name || (currentUser?.email ? currentUser.email.split('@')[0] : 'Reviewer');

  const [activeTab, setActiveTab] = useState('review');
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRows, setSelectedRows] = useState([]);
  const [templateTypeMenuAnchor, setTemplateTypeMenuAnchor] = useState(null);
  const [extractedClauses, setExtractedClauses] = useState([]);
  const [isLoadingClauses, setIsLoadingClauses] = useState(false);

  // Load real extracted clauses from backend pipeline API
  useEffect(() => {
    if (!doc) return;
    const docId = doc.documentId || doc.id;
    if (!docId) return;

    if (doc.clauses && Array.isArray(doc.clauses) && doc.clauses.length > 0) {
      setExtractedClauses(doc.clauses);
      return;
    }

    let isMounted = true;
    const loadClauses = async () => {
      setIsLoadingClauses(true);
      try {
        let rows = [];

        // 1. Try classification endpoint with needsReview query param
        const classRes = await documentService.classification(docId, {
          needsReview: activeFilter === 'to-review' ? true : undefined,
        }).catch(() => null);

        if (classRes && classRes.items && classRes.items.length > 0) {
          rows = classRes.items.map((item, i) => {
            const clauseId = item.clause_id || (item.chunk_id ? `c${i}` : `c${i}`);
            const headingTrail = item.heading_trail || item.heading || item.clause_number || `Clause ${i + 1}`;
            return {
              id: item.classification_id || item.id || `clause-${i}`,
              clause_id: clauseId,
              paraId: clauseId,
              heading_trail: headingTrail,
              breadcrumb: headingTrail,
              text: item.text || item.chunk_text || '',
              label: item.label || 'Clause',
              type_name: item.type_name || item.type || 'Unassigned',
              canonicalType: item.type_name || item.type || 'Unassigned',
              sub_type: item.sub_type || 'null',
              subType: item.sub_type || 'null',
              preview: item.preview || doc.webViewLink || '',
              confidence: item.confidence,
              needsReview: item.needs_review,
            };
          });
        }

        // 2. If no classification items, try classificationInput endpoint
        if (rows.length === 0) {
          const inputRes = await documentService.classificationInput(docId).catch(() => null);
          if (inputRes && inputRes.groups && inputRes.groups.length > 0) {
            const allParas = [];
            inputRes.groups.forEach((g) => {
              (g.paragraphs || []).forEach((p) => {
                allParas.push({
                  ...p,
                  groupSection: g.section,
                });
              });
            });

            if (allParas.length > 0) {
              rows = allParas.map((p, i) => {
                const clauseId = p.clause_id || `c${i}`;
                const headingTrail = p.heading_trail || p.groupSection || (p.number ? `Clause ${p.number}` : `Clause ${i + 1}`);
                const isFrontMatter = headingTrail && headingTrail.toUpperCase().includes('FRONT MATTER');
                return {
                  id: p.chunk_id || `chunk-${i}`,
                  clause_id: clauseId,
                  paraId: clauseId,
                  heading_trail: headingTrail,
                  breadcrumb: headingTrail,
                  text: p.text || '',
                  label: isFrontMatter ? 'Non-clause' : (p.label || 'Clause'),
                  type_name: isFrontMatter ? 'Parties' : 'Unassigned',
                  canonicalType: isFrontMatter ? 'Parties' : 'Unassigned',
                  sub_type: 'null',
                  subType: 'null',
                  preview: doc.webViewLink || '',
                };
              });
            }
          }
        }

        // 3. Fallback to extraction endpoint
        if (rows.length === 0) {
          const res = await documentService.extraction(docId).catch(() => null);
          if (res && res.clauses && res.clauses.length > 0) {
            rows = res.clauses.map((c, i) => {
              const clauseId = c.clause_id || `c${i}`;
              let headingTrail = c.heading_trail || c.path || c.title || (c.number ? `${c.number}` : `Clause ${i + 1}`);
              if (c.source === 'front_matter') {
                headingTrail = 'FRONT MATTER > Parties';
              }

              let fullText = c.text || '';
              if (c.body_text && c.body_text.trim()) {
                fullText = fullText ? `${fullText}\n${c.body_text}` : c.body_text;
              }

              const isFrontMatter = c.source === 'front_matter';
              return {
                id: c.clause_id || `clause-${i}`,
                clause_id: clauseId,
                paraId: clauseId,
                heading_trail: headingTrail,
                breadcrumb: headingTrail,
                text: fullText,
                label: isFrontMatter ? 'Non-clause' : (c.label || 'Clause'),
                type_name: c.type_name || (isFrontMatter ? 'Parties' : (c.canonical_type || c.type || (c.confidence > 0.8 ? 'Interpretation' : 'Unassigned'))),
                canonicalType: c.type_name || (isFrontMatter ? 'Parties' : (c.canonical_type || c.type || (c.confidence > 0.8 ? 'Interpretation' : 'Unassigned'))),
                sub_type: c.sub_type || 'null',
                subType: c.sub_type || 'null',
                preview: doc.webViewLink || '',
                confidence: c.confidence,
                flags: c.flags || [],
                level: c.level,
              };
            });
          }
        }

        if (isMounted) {
          setExtractedClauses(rows);
        }
      } catch (err) {
        if (isMounted) {
          console.warn('Loading clauses from API failed:', err);
          setExtractedClauses([]);
        }
      } finally {
        if (isMounted) {
          setIsLoadingClauses(false);
        }
      }
    };

    loadClauses();
    return () => {
      isMounted = false;
    };
  }, [doc, activeFilter]);

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
            <span>pages: {doc.pages ?? 1} · clauses: {doc.clauses ?? totalParas} · paragraphs: {doc.paragraphs ?? totalParas} · {doc.size}</span>
            <span>|</span>
            <span>Extraction: <strong style={{ color: doc.extractionStatus === 'rejected' ? '#b91c1c' : '#1b1f24', textTransform: 'capitalize' }}>{doc.extractionStatus ? doc.extractionStatus.replace(/_/g, ' ') : 'Extracted'}</strong></span>
            <span>|</span>
            <span>Needs review: <strong style={{ color: doc.needsReview > 0 ? '#c2410c' : '#1b1f24' }}>{doc.needsReview ?? 0}</strong></span>
            <span>|</span>
            <span>Reviewer <strong style={{ color: '#1b1f24' }}>{doc.reviewer || currentUserName}</strong></span>
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
              {isLoadingClauses ? (
                <TableRow>
                  <TableCell colSpan={8} sx={{ py: 6, textAlign: 'center' }}>
                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 2,
                        maxWidth: 360,
                        mx: 'auto',
                      }}
                    >
                      <LinearProgress sx={{ width: '100%', height: 4, borderRadius: 2 }} />
                      <Typography sx={{ fontSize: '13px', color: '#64748b' }}>
                        Loading extracted clauses from backend pipeline...
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              ) : extractedClauses.length === 0 ? (
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
                        No clauses extracted yet for this document from the backend pipeline.
                      </Typography>
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

                      {/* Clause ID / Para ID with bullet circle */}
                      <TableCell sx={{ py: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box
                            sx={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              bgcolor: idx === 0 ? '#15803d' : '#22c55e',
                              flexShrink: 0,
                            }}
                          />
                          <Typography sx={{ fontSize: '12px', fontWeight: 600, color: '#1e293b' }}>
                            {row.clause_id || row.paraId}
                          </Typography>
                        </Box>
                      </TableCell>

                      {/* Breadcrumb (heading_trail) */}
                      <TableCell sx={{ py: 1 }}>
                        <Typography sx={{ fontSize: '11.5px', fontWeight: 600, color: '#1e293b', lineHeight: 1.2 }}>
                          {row.heading_trail ? row.heading_trail.split(' > ')[0] : (row.breadcrumb ? row.breadcrumb.split('\n')[0] : 'General')}
                        </Typography>
                        {(row.heading_trail && row.heading_trail.includes(' > ')) ? (
                          <Typography sx={{ fontSize: '10.5px', color: '#64748b', lineHeight: 1.2 }}>
                            {row.heading_trail.split(' > ').slice(1).join(' > ')}
                          </Typography>
                        ) : row.breadcrumb && row.breadcrumb.split('\n')[1] ? (
                          <Typography sx={{ fontSize: '10.5px', color: '#64748b', lineHeight: 1.2 }}>
                            {row.breadcrumb.split('\n')[1]}
                          </Typography>
                        ) : null}
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
                          {row.text || '[Empty clause text]'}
                        </Typography>
                      </TableCell>

                      {/* Label */}
                      <TableCell sx={{ py: 1 }}>
                        <Chip
                          label={row.label || 'Clause'}
                          size="small"
                          sx={{
                            height: 22,
                            fontSize: '11px',
                            fontWeight: 500,
                            bgcolor: (row.label === 'Clause' || !row.label) ? '#eff6ff' : '#f8fafc',
                            color: (row.label === 'Clause' || !row.label) ? '#1d4ed8' : '#64748b',
                            border: '1px solid',
                            borderColor: (row.label === 'Clause' || !row.label) ? '#bfdbfe' : '#e2e8f0',
                          }}
                        />
                      </TableCell>

                      {/* Canonical Type (type_name) */}
                      <TableCell sx={{ py: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Typography sx={{ fontSize: '12px', color: (row.type_name || row.canonicalType) === 'Unassigned' ? '#94a3b8' : '#1e293b' }}>
                            {row.type_name || row.canonicalType || 'Unassigned'}
                          </Typography>
                          <KeyboardArrowDownIcon sx={{ fontSize: 14, color: '#94a3b8' }} />
                        </Box>
                      </TableCell>

                      {/* Sub-type */}
                      <TableCell sx={{ py: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Typography sx={{ fontSize: '12px', color: (row.sub_type || row.subType) === 'null' ? '#94a3b8' : '#1e293b' }}>
                            {row.sub_type || row.subType || 'null'}
                          </Typography>
                          <KeyboardArrowDownIcon sx={{ fontSize: 14, color: '#94a3b8' }} />
                        </Box>
                      </TableCell>

                      {/* Preview */}
                      <TableCell align="center" sx={{ py: 1 }}>
                        <Tooltip title={row.preview || doc.webViewLink ? "Open preview" : "Preview"}>
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              const previewUrl = row.preview || doc.webViewLink;
                              if (previewUrl) {
                                window.open(previewUrl, '_blank');
                              } else {
                                showToast?.(`Preview: ${row.clause_id || row.paraId} (${row.heading_trail || row.breadcrumb || 'Clause'})`);
                              }
                            }}
                            sx={{ p: 0.25, color: '#94a3b8', '&:hover': { color: '#0284c7' } }}
                          >
                            <VisibilityOutlinedIcon sx={{ fontSize: 15 }} />
                          </IconButton>
                        </Tooltip>
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
