import React, { useState, useMemo } from 'react';
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
import SearchIcon from '@mui/icons-material/Search';
import TocIcon from '@mui/icons-material/Toc';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';

function formatBreadcrumbDisplay(text) {
  if (!text) return 'General';
  if (typeof text === 'string' && text === text.toUpperCase() && text.length > 2) {
    const match = text.match(/^(\d+[.)]\s*)(.+)$/);
    if (match) {
      const num = match[1];
      const rest = match[2].toLowerCase();
      return num + rest.charAt(0).toUpperCase() + rest.slice(1);
    }
    const lower = text.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }
  return text;
}

export default function ClauseTable({
  extractedClauses = [],
  isLoading = false,
  canEdit = true,
  docName = '',
  doc = null,
  webViewLink = '',
  selectedRows = [],
  onSelectAll,
  onToggleRow,
  highlightedClauseId,
  onHighlightClause,
  previewClause,
  isPreviewOpen,
  isContentsOpen,
  onToggleContents,
  onOpenPreview,
  onUpdateRow,
  availableCanonicalTypes = [],
  showToast,
  searchQuery,
  onSearchChange,
  activeFilter,
  onFilterChange,
  typeFilter,
  onTypeFilterChange,
  needsFixCount = 0,
}) {
  // Inline text editing state
  const [editingTextRowId, setEditingTextRowId] = useState(null);
  const [editingTextValue, setEditingTextValue] = useState('');

  // Row dropdown menus
  const [labelAnchor, setLabelAnchor] = useState(null);
  const [typeAnchor, setTypeAnchor] = useState(null);
  const [templateTypeMenuAnchor, setTemplateTypeMenuAnchor] = useState(null);

  // Text expansion state for "Know more" / "Show less"
  const [expandedTextRows, setExpandedTextRows] = useState(() => new Set());
  const toggleExpandRow = (rowKey) => {
    setExpandedTextRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }
      return next;
    });
  };

  const handleStartEditText = (rowId, currentText, e) => {
    if (e) e.stopPropagation();
    if (!canEdit) return;
    setEditingTextRowId(rowId);
    setEditingTextValue(currentText || '');
  };

  const handleCancelEditText = (e) => {
    if (e) e.stopPropagation();
    setEditingTextRowId(null);
    setEditingTextValue('');
  };

  const handleSaveEditText = (rowId, e) => {
    if (e) e.stopPropagation();
    onUpdateRow(rowId, { text: editingTextValue, is_text_modified: true });
    setEditingTextRowId(null);
    setEditingTextValue('');
    showToast?.('Text updated. Click Save to persist changes to API.', 'info');
  };

  // Filtered rows for the table based on activeFilter, typeFilter, and searchQuery
  const filteredClauses = useMemo(() => {
    return extractedClauses.filter((row) => {
      // 1. Tab filter
      if (activeFilter === 'to-review' && !row.needs_review) return false;
      if (
        activeFilter === 'needs-fix' &&
        !(row.deviated || row.outcome === 'failed' || (row.review_reasons && row.review_reasons.length > 0))
      )
        return false;
      if (activeFilter === 'edited' && !row.review) return false;
      if (
        activeFilter === 'low-conf' &&
        !(
          (row.confidence !== null && row.confidence !== undefined && row.confidence < 0.85) ||
          (row.review_reasons && row.review_reasons.includes('low_confidence'))
        )
      )
        return false;

      // 2. Type menu filter
      if (typeFilter === 'clauses' && row.label !== 'Clause') return false;
      if (typeFilter === 'non-clauses' && row.label !== 'Non-clause') return false;

      // 3. Search query
      if (searchQuery && searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const textMatch = (row.text || '').toLowerCase().includes(q);
        const breadcrumbMatch = (row.breadcrumb || '').toLowerCase().includes(q);
        const idMatch = (row.clause_id || row.paraId || '').toLowerCase().includes(q);
        const typeMatch = (row.type_name || row.canonicalType || '').toLowerCase().includes(q);
        const subTypeMatch = (row.sub_type || '').toLowerCase().includes(q);
        if (!textMatch && !breadcrumbMatch && !idMatch && !typeMatch && !subTypeMatch) return false;
      }
      return true;
    });
  }, [extractedClauses, activeFilter, typeFilter, searchQuery]);

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, overflow: 'hidden' }}>
      {/* Search & Filter Toolbar */}
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
          flexShrink: 0,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
          {/* Contents button (toggles left contents slide drawer) */}
          <Button
            size="small"
            startIcon={<TocIcon sx={{ fontSize: 17 }} />}
            onClick={onToggleContents}
            sx={{
              height: 32,
              fontSize: '12px',
              fontWeight: 600,
              textTransform: 'none',
              px: 1.5,
              borderRadius: 1.5,
              bgcolor: isContentsOpen ? '#1e3a5f' : '#ffffff',
              color: isContentsOpen ? '#ffffff' : '#374151',
              border: '1px solid',
              borderColor: isContentsOpen ? '#1e3a5f' : '#cfcfc8',
              boxShadow: isContentsOpen ? '0 1px 2px rgba(30, 58, 95, 0.15)' : 'none',
              '&:hover': {
                bgcolor: isContentsOpen ? '#152943' : '#f5f5f2',
                borderColor: isContentsOpen ? '#152943' : '#b9cde0',
              },
            }}
          >
            Contents
          </Button>

          {/* Find in document */}
          <TextField
            size="small"
            placeholder="Find in this document..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
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
              { id: 'needs-fix', label: `Needs review ${needsFixCount > 0 ? `(${needsFixCount})` : ''}` },
            ].map((f) => (
              <Button
                key={f.id}
                size="small"
                onClick={() => onFilterChange(f.id)}
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
              {typeFilter === 'clauses' ? 'Clauses only' : typeFilter === 'non-clauses' ? 'Non-clause' : 'All types'}
            </Button>
            <Menu
              anchorEl={templateTypeMenuAnchor}
              open={Boolean(templateTypeMenuAnchor)}
              onClose={() => setTemplateTypeMenuAnchor(null)}
              slotProps={{ paper: { sx: { fontSize: '12px', minWidth: 140 } } }}
            >
              <MenuItem
                onClick={() => {
                  onTypeFilterChange('all');
                  setTemplateTypeMenuAnchor(null);
                }}
              >
                All types
              </MenuItem>
              <MenuItem
                onClick={() => {
                  onTypeFilterChange('clauses');
                  setTemplateTypeMenuAnchor(null);
                }}
              >
                Clauses only
              </MenuItem>
              <MenuItem
                onClick={() => {
                  onTypeFilterChange('non-clauses');
                  setTemplateTypeMenuAnchor(null);
                }}
              >
                Non-clause
              </MenuItem>
            </Menu>
          </Box>
        </Box>

        {/* Right Buttons: Source document */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button
            size="small"
            startIcon={<ArticleOutlinedIcon sx={{ fontSize: 16 }} />}
            onClick={() => {
              const link = doc?.webViewLink || webViewLink || doc?.drive_web_link;
              if (link) {
                window.open(link, '_blank');
              } else {
                showToast?.(`Opening source document view for ${doc?.fileName || docName}`);
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

      {/* Main Table Container */}
      <Box
        sx={{
          flex: isPreviewOpen && isContentsOpen
            ? { xs: '1 1 100%', md: '1 1 42%', lg: '1 1 45%' }
            : isPreviewOpen
              ? { xs: '1 1 100%', md: '1 1 56%' }
              : '1 1 100%',
          height: '100%',
          overflowY: 'auto',
          minWidth: 0,
          transition: 'flex 0.25s ease',
          display: isPreviewOpen ? { xs: 'none', md: 'block' } : 'block',
        }}
      >
        <TableContainer sx={{ width: '100%', height: '100%' }}>
          <Table stickyHeader size="small" sx={{ width: '100%', minWidth: 900 }}>
            <TableHead>
              <TableRow>
                <TableCell
                  padding="checkbox"
                  sx={{ bgcolor: '#fafaf8', py: 1, borderBottom: '1px solid #e3e3de', width: 44, minWidth: 44, verticalAlign: 'middle' }}
                >
                  <Checkbox
                    size="small"
                    indeterminate={selectedRows.length > 0 && selectedRows.length < filteredClauses.length}
                    checked={filteredClauses.length > 0 && selectedRows.length === filteredClauses.length}
                    onChange={onSelectAll}
                    disabled={filteredClauses.length === 0}
                    sx={{ p: 0.5 }}
                  />
                </TableCell>
                <TableCell
                  sx={{ bgcolor: '#fafaf8', py: 1, fontSize: '11.5px', fontWeight: 600, color: '#7b838c', borderBottom: '1px solid #e3e3de', width: 85, minWidth: 85, verticalAlign: 'middle' }}
                >
                  Clause ID
                </TableCell>
                <TableCell
                  sx={{ bgcolor: '#fafaf8', py: 1, fontSize: '11.5px', fontWeight: 600, color: '#7b838c', borderBottom: '1px solid #e3e3de', width: 155, minWidth: 155, verticalAlign: 'middle' }}
                >
                  Breadcrumb
                </TableCell>
                <TableCell
                  sx={{ bgcolor: '#fafaf8', py: 1, fontSize: '11.5px', fontWeight: 600, color: '#7b838c', borderBottom: '1px solid #e3e3de', minWidth: 360, verticalAlign: 'middle' }}
                >
                  Text Information
                </TableCell>
                <TableCell
                  sx={{ bgcolor: '#fafaf8', py: 1, fontSize: '11.5px', fontWeight: 600, color: '#7b838c', borderBottom: '1px solid #e3e3de', width: 110, minWidth: 110, verticalAlign: 'middle' }}
                >
                  Label
                </TableCell>
                <TableCell
                  sx={{ bgcolor: '#fafaf8', py: 1, fontSize: '11.5px', fontWeight: 600, color: '#7b838c', borderBottom: '1px solid #e3e3de', width: 180, minWidth: 160, verticalAlign: 'middle' }}
                >
                  Sub-type / Canonical type
                </TableCell>
                <TableCell
                  align="center"
                  sx={{ bgcolor: '#fafaf8', py: 1, fontSize: '11.5px', fontWeight: 600, color: '#7b838c', borderBottom: '1px solid #e3e3de', width: 60, minWidth: 60, verticalAlign: 'middle' }}
                >
                  Preview
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} sx={{ py: 6, textAlign: 'center', verticalAlign: 'middle' }}>
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
                        Loading classification from backend pipeline...
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              ) : filteredClauses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} sx={{ py: 6, textAlign: 'center', verticalAlign: 'middle' }}>
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
                        {extractedClauses.length === 0 ? `No clauses found for ${docName}` : 'No matching clauses found'}
                      </Typography>
                      <Typography sx={{ fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                        {extractedClauses.length === 0
                          ? `No classification data returned from backend.`
                          : 'Try changing your filter pills or search keyword.'}
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              ) : (
                filteredClauses.map((row, idx) => {
                  const isSelected = selectedRows.includes(idx);
                  const isPreviewActive =
                    isPreviewOpen &&
                    ((previewClause?.id && previewClause.id === row.id) ||
                      (previewClause?.clause_id && previewClause.clause_id === row.clause_id) ||
                      (previewClause?.paraId && previewClause.paraId === row.paraId));
                  const rowKey = row.id || row.clause_id || row.paraId || idx;
                  const isRowHighlighted =
                    isPreviewActive ||
                    (highlightedClauseId &&
                      (highlightedClauseId === row.id ||
                        highlightedClauseId === row.clause_id ||
                        highlightedClauseId === row.paraId ||
                        highlightedClauseId === rowKey));

                  const isTextExpanded = expandedTextRows.has(rowKey);
                  const textContent = row.text || '';
                  const CHAR_LIMIT = 400;
                  const needsTruncation = textContent.length > CHAR_LIMIT;

                  return (
                    <TableRow
                      id={`table-clause-row-${row.id || row.clause_id || row.paraId || idx}`}
                      key={row.paraId || row.id || idx}
                      hover
                      selected={isSelected}
                      onClick={() => {
                        const targetId = row.clause_id || row.paraId || row.id || idx;
                        onHighlightClause(targetId, row);
                      }}
                      sx={{
                        cursor: 'pointer',
                        borderLeft: isRowHighlighted
                          ? '4px solid #2563eb'
                          : idx === 0
                            ? '3px solid #0284c7'
                            : '3px solid transparent',
                        bgcolor: isRowHighlighted
                          ? '#eff6ff'
                          : idx === 0
                            ? '#f8fafc'
                            : isSelected
                              ? '#f1f5f9'
                              : '#ffffff',
                        boxShadow: isRowHighlighted ? 'inset 0 0 0 1px #bfdbfe' : 'none',
                        transition: 'all 0.15s ease',
                        '&:hover': { bgcolor: isRowHighlighted ? '#e0f2fe' : '#f8fafc' },
                      }}
                    >
                      <TableCell padding="checkbox" sx={{ py: 1.25, verticalAlign: 'middle' }}>
                        <Checkbox
                          size="small"
                          checked={isSelected}
                          onChange={() => onToggleRow(idx)}
                          onClick={(e) => e.stopPropagation()}
                          sx={{ p: 0.5 }}
                        />
                      </TableCell>

                      {/* Clause ID */}
                      <TableCell sx={{ py: 1.25, verticalAlign: 'middle' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Tooltip title={row.needs_review ? 'Needs review' : 'High confidence / Verified'}>
                            <Box
                              sx={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                bgcolor: row.needs_review ? '#f59e0b' : '#22c55e',
                                flexShrink: 0,
                              }}
                            />
                          </Tooltip>
                          <Typography sx={{ fontSize: '12px', fontWeight: 600, color: '#1e293b' }}>
                            {row.clause_id || row.paraId}
                          </Typography>
                        </Box>
                      </TableCell>

                      {/* Breadcrumb */}
                      <TableCell sx={{ py: 1.25, verticalAlign: 'middle' }}>
                        <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                          <Typography
                            sx={{
                              fontSize: '12px',
                              fontWeight: 600,
                              color: '#1e293b',
                              fontFamily: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                              letterSpacing: '0.01em',
                              lineHeight: 1.35,
                            }}
                          >
                            {formatBreadcrumbDisplay(
                              row.breadcrumb?.includes(' > ')
                                ? row.breadcrumb.split(' > ')[0]
                                : row.heading_trail || 'General'
                            )}
                          </Typography>
                          {row.breadcrumb?.includes(' > ') ? (
                            <Typography
                              sx={{
                                fontSize: '11px',
                                color: '#64748b',
                                lineHeight: 1.3,
                                mt: 0.25,
                                fontFamily: "'IBM Plex Sans', -apple-system, sans-serif",
                              }}
                            >
                              {row.breadcrumb
                                .split(' > ')
                                .slice(1)
                                .map(formatBreadcrumbDisplay)
                                .join(' › ')}
                            </Typography>
                          ) : row.heading_trail && row.heading_trail !== row.breadcrumb ? (
                            <Typography
                              sx={{
                                fontSize: '11px',
                                color: '#64748b',
                                lineHeight: 1.3,
                                mt: 0.25,
                                fontFamily: "'IBM Plex Sans', -apple-system, sans-serif",
                              }}
                            >
                              {formatBreadcrumbDisplay(row.heading_trail)}
                            </Typography>
                          ) : null}
                        </Box>
                      </TableCell>

                      {/* Text Information with Inline Edit */}
                      <TableCell sx={{ py: 1.25, pr: 2, verticalAlign: 'middle' }}>
                        {editingTextRowId === (row.id || row.clause_id || row.paraId || idx) ? (
                          <Box
                            onClick={(e) => e.stopPropagation()}
                            sx={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 1,
                              py: 0.5,
                              width: '100%',
                            }}
                          >
                            <TextField
                              fullWidth
                              multiline
                              minRows={2}
                              maxRows={8}
                              autoFocus
                              value={editingTextValue}
                              onChange={(e) => setEditingTextValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                  e.preventDefault();
                                  handleSaveEditText(row.id, e);
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  handleCancelEditText(e);
                                }
                              }}
                              placeholder="Edit clause text..."
                              size="small"
                              sx={{
                                '& .MuiOutlinedInput-root': {
                                  fontSize: '12.5px',
                                  lineHeight: 1.5,
                                  bgcolor: '#ffffff',
                                  borderRadius: 1.5,
                                  '& fieldset': { borderColor: '#3b82f6', borderWidth: 1.5 },
                                },
                              }}
                            />
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                              <Typography sx={{ fontSize: '11px', color: '#64748b' }}>
                                Press <kbd style={{ padding: '1px 4px', background: '#f1f5f9', borderRadius: 3, border: '1px solid #cbd5e1' }}>Ctrl+Enter</kbd> to apply
                              </Typography>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                <Button
                                  size="small"
                                  variant="text"
                                  onClick={(e) => handleCancelEditText(e)}
                                  sx={{
                                    height: 26,
                                    fontSize: '11.5px',
                                    textTransform: 'none',
                                    color: '#64748b',
                                    px: 1,
                                    borderRadius: 1,
                                    '&:hover': { bgcolor: '#f1f5f9', color: '#0f172a' },
                                  }}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  size="small"
                                  variant="contained"
                                  startIcon={<CheckCircleOutlinedIcon sx={{ fontSize: '14px !important' }} />}
                                  onClick={(e) => handleSaveEditText(row.id, e)}
                                  sx={{
                                    height: 26,
                                    fontSize: '11.5px',
                                    fontWeight: 600,
                                    textTransform: 'none',
                                    bgcolor: '#1e3a5f',
                                    px: 1.25,
                                    borderRadius: 1,
                                    boxShadow: 'none',
                                    '&:hover': { bgcolor: '#162d4a', boxShadow: 'none' },
                                  }}
                                >
                                  Done
                                </Button>
                              </Box>
                            </Box>
                          </Box>
                        ) : (
                          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              {!textContent ? (
                                <Typography sx={{ fontSize: '12.5px', color: '#94a3b8', fontStyle: 'italic' }}>
                                  [Empty clause text]
                                </Typography>
                              ) : !needsTruncation ? (
                                <Typography
                                  sx={{
                                    fontSize: '12.5px',
                                    color: '#1e293b',
                                    lineHeight: 1.55,
                                    letterSpacing: '0.005em',
                                    whiteSpace: 'normal',
                                    wordBreak: 'break-word',
                                  }}
                                >
                                  {textContent}
                                </Typography>
                              ) : (
                                <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                                  <Typography
                                    sx={{
                                      fontSize: '12.5px',
                                      color: '#1e293b',
                                      lineHeight: 1.55,
                                      letterSpacing: '0.005em',
                                      whiteSpace: 'normal',
                                      wordBreak: 'break-word',
                                    }}
                                  >
                                    {isTextExpanded ? textContent : `${textContent.slice(0, CHAR_LIMIT)}... `}
                                    {!isTextExpanded && (
                                      <Box
                                        component="span"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleExpandRow(rowKey);
                                        }}
                                        sx={{
                                          color: '#0284c7',
                                          fontWeight: 600,
                                          fontSize: '11.5px',
                                          cursor: 'pointer',
                                          display: 'inline-block',
                                          ml: 0.5,
                                          '&:hover': { textDecoration: 'underline', color: '#0369a1' },
                                        }}
                                      >
                                        Know more
                                      </Box>
                                    )}
                                  </Typography>
                                  {isTextExpanded && (
                                    <Box sx={{ mt: 0.5 }}>
                                      <Box
                                        component="span"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleExpandRow(rowKey);
                                        }}
                                        sx={{
                                          color: '#64748b',
                                          fontWeight: 600,
                                          fontSize: '11px',
                                          cursor: 'pointer',
                                          display: 'inline-block',
                                          '&:hover': { textDecoration: 'underline', color: '#0284c7' },
                                        }}
                                      >
                                        Show less ↑
                                      </Box>
                                    </Box>
                                  )}
                                </Box>
                              )}
                              {row.is_text_modified && (
                                <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <Chip
                                    label="Edited"
                                    size="small"
                                    sx={{
                                      height: 18,
                                      fontSize: '10px',
                                      fontWeight: 600,
                                      bgcolor: '#fef3c7',
                                      color: '#92400e',
                                      border: '1px solid #fde68a',
                                    }}
                                  />
                                </Box>
                              )}
                            </Box>

                            {/* Edit Icon Button */}
                            <Tooltip title={canEdit ? 'Edit text information' : 'Read-only mode'}>
                              <span>
                                <IconButton
                                  size="small"
                                  disabled={!canEdit}
                                  onClick={(e) =>
                                    handleStartEditText(row.id || row.clause_id || row.paraId || idx, textContent, e)
                                  }
                                  sx={{
                                    p: 0.5,
                                    color: '#64748b',
                                    borderRadius: 1,
                                    flexShrink: 0,
                                    opacity: 0.7,
                                    border: '1px solid transparent',
                                    '&:hover': {
                                      opacity: 1,
                                      color: '#1e3a5f',
                                      bgcolor: '#f1f5f9',
                                      borderColor: '#cbd5e1',
                                    },
                                  }}
                                >
                                  <EditOutlinedIcon sx={{ fontSize: 15 }} />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </Box>
                        )}
                      </TableCell>

                      {/* Label with Dropdown */}
                      <TableCell sx={{ py: 1.25, verticalAlign: 'middle' }}>
                        <Button
                          size="small"
                          disabled={!canEdit}
                          onClick={(e) => {
                            e.stopPropagation();
                            setLabelAnchor({ el: e.currentTarget, rowId: row.id, current: row.label });
                          }}
                          sx={{
                            height: 26,
                            minWidth: 84,
                            fontSize: '11px',
                            fontWeight: 500,
                            textTransform: 'none',
                            px: 1,
                            borderRadius: 1,
                            bgcolor: row.label === 'Clause' ? '#eff6ff' : '#f8fafc',
                            color: row.label === 'Clause' ? '#1d4ed8' : '#64748b',
                            border:
                              labelAnchor?.rowId === row.id
                                ? '1.5px solid #1e3a5f'
                                : row.label === 'Clause'
                                  ? '1px solid #bfdbfe'
                                  : '1px solid #e2e8f0',
                            boxShadow: labelAnchor?.rowId === row.id ? '0 0 0 1px #1e3a5f' : 'none',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            '&:hover': {
                              bgcolor: row.label === 'Clause' ? '#dbeafe' : '#f1f5f9',
                              borderColor: '#1e3a5f',
                            },
                          }}
                        >
                          {row.label || 'Clause'}
                        </Button>
                      </TableCell>

                      {/* Merged: Above Sub-type box, Below Canonical drop down */}
                      <TableCell sx={{ py: 1, verticalAlign: 'middle' }}>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6, width: '100%', minWidth: 125, maxWidth: 165 }}>
                          {/* Above: Sub-type box */}
                          <TextField
                            size="small"
                            disabled={!canEdit}
                            placeholder="Sub-type"
                            value={row.sub_type || ''}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              onUpdateRow(row.id, {
                                sub_type: e.target.value,
                                subType: e.target.value,
                              })
                            }
                            sx={{
                              width: '100%',
                              '& .MuiOutlinedInput-root': {
                                height: 26,
                                fontSize: '11.5px',
                                bgcolor: '#ffffff',
                                borderRadius: 1,
                                '& fieldset': { borderColor: '#cbd5e1' },
                                '&:hover fieldset': { borderColor: '#94a3b8' },
                                '&.Mui-focused fieldset': { borderColor: '#1e3a5f' },
                              },
                              '& .MuiInputBase-input': {
                                py: 0.35,
                                px: 1,
                                fontSize: '11.5px',
                                color: '#1e293b',
                              },
                            }}
                          />

                          {/* Below: Canonical type dropdown */}
                          <Box
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!canEdit) return;
                              setTypeAnchor({
                                el: e.currentTarget,
                                rowId: row.id,
                                current: row.type_name || row.canonicalType,
                              });
                            }}
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              px: 1,
                              py: 0.35,
                              height: 26,
                              borderRadius: 1,
                              cursor: canEdit ? 'pointer' : 'default',
                              border: typeAnchor?.rowId === row.id ? '1.5px solid #1e3a5f' : '1px solid #cbd5e1',
                              bgcolor: '#ffffff',
                              boxShadow: typeAnchor?.rowId === row.id ? '0 0 0 1px #1e3a5f' : 'none',
                              '&:hover': {
                                borderColor: canEdit ? '#1e3a5f' : '#cbd5e1',
                              },
                            }}
                          >
                            <Typography
                              sx={{
                                fontSize: '11.5px',
                                fontWeight: 500,
                                color:
                                  (row.type_name || row.canonicalType) === 'Unassigned' ? '#94a3b8' : '#1e293b',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                mr: 0.5,
                              }}
                            >
                              {row.type_name || row.canonicalType || 'Unassigned'}
                            </Typography>
                            <KeyboardArrowDownIcon sx={{ fontSize: 14, color: '#64748b', flexShrink: 0 }} />
                          </Box>
                        </Box>
                      </TableCell>

                      {/* Preview button */}
                      <TableCell align="center" sx={{ py: 1.25, verticalAlign: 'middle' }}>
                        <Tooltip title="Preview in full document">
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenPreview(row);
                            }}
                            sx={{
                              p: 0.5,
                              borderRadius: 1,
                              color: isPreviewActive ? '#0284c7' : '#94a3b8',
                              bgcolor: isPreviewActive ? '#e0f2fe' : 'transparent',
                              '&:hover': { color: '#0284c7', bgcolor: '#f0f9ff' },
                            }}
                          >
                            <VisibilityOutlinedIcon sx={{ fontSize: 16 }} />
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

      {/* Footer Status Bar with Shortcuts */}
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
          flexShrink: 0,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <span>{selectedRows.length > 0 ? `${selectedRows.length} row(s) selected` : 'No rows selected'}</span>
          <span>|</span>
          <span style={{ color: '#0f172a', fontWeight: 500 }}>{docName}</span>
          <span>|</span>
          <span>
            Showing {filteredClauses.length} of {extractedClauses.length} items
          </span>
        </Box>
      </Box>

      {/* Floating Menu for Label (Clause / Non-clause) */}
      <Menu
        anchorEl={labelAnchor?.el}
        open={Boolean(labelAnchor)}
        onClose={() => setLabelAnchor(null)}
        slotProps={{
          paper: {
            sx: {
              fontSize: '12px',
              minWidth: 110,
              mt: 0.5,
              borderRadius: 1,
              border: '1px solid #cbd5e1',
              boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
              p: 0,
            },
          },
        }}
      >
        {['Clause', 'Non-clause'].map((lbl) => {
          const isSelected = labelAnchor?.current === lbl;
          return (
            <MenuItem
              key={lbl}
              selected={isSelected}
              onClick={() => {
                onUpdateRow(labelAnchor.rowId, {
                  label: lbl,
                  sub_type: lbl === 'Non-clause' ? null : undefined,
                });
                setLabelAnchor(null);
              }}
              sx={{
                fontSize: '12px',
                fontWeight: isSelected ? 600 : 400,
                py: 0.7,
                px: 1.5,
                color: isSelected ? '#ffffff !important' : '#1e293b',
                bgcolor: isSelected ? '#1976d2 !important' : 'transparent',
                '&:hover': {
                  bgcolor: isSelected ? '#1565c0 !important' : '#f1f5f9',
                },
              }}
            >
              {lbl}
            </MenuItem>
          );
        })}
      </Menu>

      {/* Floating Menu for Canonical Type */}
      <Menu
        anchorEl={typeAnchor?.el}
        open={Boolean(typeAnchor)}
        onClose={() => setTypeAnchor(null)}
        slotProps={{
          paper: {
            sx: {
              maxHeight: 280,
              minWidth: 200,
              mt: 0.5,
              borderRadius: 1,
              border: '1px solid #cbd5e1',
              boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
              p: 0,
            },
          },
        }}
      >
        {availableCanonicalTypes.map((t) => {
          const isSelected = (typeAnchor?.current || '').toLowerCase() === t.toLowerCase();
          return (
            <MenuItem
              key={t}
              selected={isSelected}
              onClick={() => {
                onUpdateRow(typeAnchor.rowId, {
                  type_name: t,
                  canonicalType: t,
                  type: t === 'Unassigned' ? null : t.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                });
                setTypeAnchor(null);
              }}
              sx={{
                fontSize: '12px',
                fontWeight: isSelected ? 600 : 400,
                py: 0.7,
                px: 1.5,
                color: isSelected ? '#ffffff !important' : '#1e293b',
                bgcolor: isSelected ? '#1976d2 !important' : 'transparent',
                '&:hover': {
                  bgcolor: isSelected ? '#1565c0 !important' : '#f1f5f9',
                },
              }}
            >
              {t}
            </MenuItem>
          );
        })}
      </Menu>
    </Box>
  );
}
