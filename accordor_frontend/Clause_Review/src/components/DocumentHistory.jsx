import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box,
  Typography,
  Chip,
  Button,
  IconButton,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Paper,
  CircularProgress,
  Tooltip,
  TextField,
  InputAdornment,
} from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import RefreshIcon from '@mui/icons-material/Refresh';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SearchIcon from '@mui/icons-material/Search';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { documentService } from '../services/documentService';

function formatTimestamp(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(d);
  } catch {
    return isoStr;
  }
}

function formatActionLabel(action) {
  if (!action) return 'Activity';
  const clean = action.replace(/^act_/i, '').replace(/_/g, ' ');
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function getActionChipStyle(action) {
  const act = (action || '').toLowerCase();
  if (act.includes('save')) {
    return { bgcolor: '#f3e8ff', color: '#6b21a8', border: '1px solid #e9d5ff' };
  }
  if (act.includes('ingest') || act.includes('sync')) {
    return { bgcolor: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' };
  }
  if (act.includes('classif')) {
    return { bgcolor: '#e0e7ff', color: '#3730a3', border: '1px solid #c7d2fe' };
  }
  if (act.includes('parse') || act.includes('stage')) {
    return { bgcolor: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' };
  }
  if (act.includes('review')) {
    return { bgcolor: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' };
  }
  return { bgcolor: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1' };
}

export default function DocumentHistory({
  docId,
  docName = 'Document',
  onReturnToReview,
  onHistoryCountUpdate,
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [historyData, setHistoryData] = useState(null);
  const [copiedId, setCopiedId] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [phaseFilter, setPhaseFilter] = useState('all');

  const fetchHistory = useCallback(async () => {
    if (!docId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await documentService.getDocumentActivity(docId);
      setHistoryData(res);

      // Compute total events and notify parent for tab count badge
      let total = 0;
      if (res?.phases && Array.isArray(res.phases)) {
        res.phases.forEach((p) => {
          if (Array.isArray(p.events)) total += p.events.length;
        });
      } else if (Array.isArray(res)) {
        total = res.length;
      } else if (Array.isArray(res?.events)) {
        total = res.events.length;
      } else if (Array.isArray(res?.activities)) {
        total = res.activities.length;
      } else if (Array.isArray(res?.results)) {
        total = res.results.length;
      }
      if (onHistoryCountUpdate) {
        onHistoryCountUpdate(total);
      }
    } catch (err) {
      console.warn('Failed to fetch document activity:', err);
      setError(err.message || 'Could not load activity log.');
    } finally {
      setLoading(false);
    }
  }, [docId, onHistoryCountUpdate]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Flatten and normalize all events from API response
  const allEvents = useMemo(() => {
    if (!historyData) return [];
    const list = [];
    const documentId = historyData.document_id || historyData.documentId || docId;

    // Helper to normalize single activity item
    const normalizeItem = (evt, defaultPhase = '', defaultPhaseLabel = '') => {
      return {
        id: evt.id || `${evt.action || 'act'}-${evt.created_at || evt.timestamp || Math.random()}`,
        document_id: evt.document_id || evt.documentId || evt.doc_id || documentId,
        action: evt.action || 'Unknown action',
        summary: evt.summary || evt.description || evt.message || 'No summary provided',
        created_at: evt.created_at || evt.timestamp || evt.createdAt || '',
        actor: evt.actor || evt.user || evt.username || 'System',
        phaseKey: evt.phase || defaultPhase,
        phaseLabel: evt.phase_label || evt.phaseLabel || defaultPhaseLabel || defaultPhase,
      };
    };

    // Case 1: Structured 5-phase timeline
    if (historyData.phases && Array.isArray(historyData.phases)) {
      historyData.phases.forEach((phase) => {
        const phaseLabel = phase.label || phase.phase || '';
        const phaseKey = phase.phase || '';
        if (Array.isArray(phase.events)) {
          phase.events.forEach((evt) => {
            list.push(normalizeItem(evt, phaseKey, phaseLabel));
          });
        }
      });
    }
    // Case 2: Array returned directly
    else if (Array.isArray(historyData)) {
      historyData.forEach((evt) => list.push(normalizeItem(evt)));
    }
    // Case 3: Flat events or activities inside an object
    else {
      const rawEvents = historyData.events || historyData.activities || historyData.results || historyData.history;
      if (Array.isArray(rawEvents)) {
        rawEvents.forEach((evt) => list.push(normalizeItem(evt)));
      }
    }

    // Sort descending by created_at (newest first)
    list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    return list;
  }, [historyData, docId]);

  // Filter events by search query and phase
  const filteredEvents = useMemo(() => {
    return allEvents.filter((item) => {
      if (phaseFilter !== 'all' && item.phaseKey !== phaseFilter) return false;
      if (searchQuery && searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const actionMatch = item.action.toLowerCase().includes(q);
        const summaryMatch = item.summary.toLowerCase().includes(q);
        const actorMatch = item.actor.toLowerCase().includes(q);
        const docIdMatch = item.document_id.toLowerCase().includes(q);
        if (!actionMatch && !summaryMatch && !actorMatch && !docIdMatch) return false;
      }
      return true;
    });
  }, [allEvents, phaseFilter, searchQuery]);

  const handleCopyDocId = () => {
    if (!docId) return;
    navigator.clipboard?.writeText(docId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const documentId = historyData?.document_id || docId;

  return (
    <Box sx={{ flex: 1, overflowY: 'auto', p: { xs: 2.5, sm: 4 }, bgcolor: '#fafaf8' }}>
      <Box sx={{ maxWidth: 1100, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {/* Header Row */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 2,
          }}
        >
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
              <Typography sx={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                Document History & Activity
              </Typography>
              <Chip
                label={`${allEvents.length} Event${allEvents.length === 1 ? '' : 's'}`}
                size="small"
                sx={{ bgcolor: '#e0f2fe', color: '#0369a1', fontWeight: 600, fontSize: '11px' }}
              />
            </Box>
            <Typography sx={{ fontSize: '13px', color: '#64748b' }}>
              Full audit trail and lifecycle events for <strong>{docName}</strong>.
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            {/* Document ID Chip with copy button */}
            <Tooltip title={copiedId ? 'Copied!' : 'Click to copy Document ID'}>
              <Chip
                icon={
                  copiedId ? (
                    <CheckCircleIcon sx={{ fontSize: '14px !important', color: '#16a34a !important' }} />
                  ) : (
                    <ContentCopyIcon sx={{ fontSize: '13px !important', color: '#64748b !important' }} />
                  )
                }
                label={`ID: ${documentId.slice(0, 8)}...`}
                onClick={handleCopyDocId}
                size="small"
                variant="outlined"
                sx={{
                  fontFamily: 'monospace',
                  fontSize: '11.5px',
                  borderColor: '#cbd5e1',
                  cursor: 'pointer',
                  bgcolor: '#ffffff',
                  '&:hover': { bgcolor: '#f1f5f9', borderColor: '#94a3b8' },
                }}
              />
            </Tooltip>

            {/* Refresh Button */}
            <Button
              variant="outlined"
              size="small"
              startIcon={<RefreshIcon sx={{ fontSize: 16 }} />}
              onClick={fetchHistory}
              disabled={loading}
              sx={{
                height: 30,
                fontSize: '12px',
                textTransform: 'none',
                color: '#1e3a5f',
                borderColor: '#cbd5e1',
                fontWeight: 600,
                '&:hover': { borderColor: '#1e3a5f', bgcolor: '#f8fafc' },
              }}
            >
              Refresh
            </Button>

            {onReturnToReview && (
              <Button
                variant="contained"
                size="small"
                startIcon={<ArrowBackIcon sx={{ fontSize: 15 }} />}
                onClick={onReturnToReview}
                sx={{
                  height: 30,
                  fontSize: '12px',
                  textTransform: 'none',
                  bgcolor: '#1e3a5f',
                  color: '#ffffff',
                  fontWeight: 600,
                  boxShadow: 'none',
                  '&:hover': { bgcolor: '#152943', boxShadow: 'none' },
                }}
              >
                Back to Review
              </Button>
            )}
          </Box>
        </Box>

        {/* Filter & Search Bar */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 1.5,
            p: 1.5,
            bgcolor: '#ffffff',
            borderRadius: 2,
            border: '1px solid #e2e8f0',
          }}
        >
          {/* Search box */}
          <TextField
            size="small"
            placeholder="Search action or summary..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            sx={{
              width: { xs: '100%', sm: 260 },
              '& .MuiOutlinedInput-root': {
                height: 32,
                fontSize: '12px',
                borderRadius: 1.5,
                bgcolor: '#fafaf8',
                '& fieldset': { borderColor: '#cbd5e1' },
                '&:hover fieldset': { borderColor: '#94a3b8' },
                '&.Mui-focused fieldset': { borderColor: '#1e3a5f' },
              },
            }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: '#94a3b8', fontSize: 16 }} />
                  </InputAdornment>
                ),
              },
            }}
          />

          {/* Phase Filter Chips */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            {[
              { id: 'all', label: `All (${allEvents.length})` },
              { id: 'data_ingestion', label: 'Ingestion' },
              { id: 'data_parsing', label: 'Parsing' },
              { id: 'data_classification', label: 'Classification' },
              { id: 'user_interaction', label: 'User Edits & Saves' },
            ].map((f) => (
              <Button
                key={f.id}
                size="small"
                onClick={() => setPhaseFilter(f.id)}
                sx={{
                  height: 26,
                  fontSize: '11px',
                  fontWeight: phaseFilter === f.id ? 600 : 500,
                  textTransform: 'none',
                  px: 1.25,
                  borderRadius: 1.5,
                  bgcolor: phaseFilter === f.id ? '#1e3a5f' : '#f8fafc',
                  color: phaseFilter === f.id ? '#ffffff' : '#475569',
                  border: '1px solid',
                  borderColor: phaseFilter === f.id ? '#1e3a5f' : '#e2e8f0',
                  '&:hover': {
                    bgcolor: phaseFilter === f.id ? '#152943' : '#f1f5f9',
                  },
                }}
              >
                {f.label}
              </Button>
            ))}
          </Box>
        </Box>

        {/* Content Area */}
        {loading ? (
          <Paper
            elevation={0}
            sx={{
              p: 6,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              bgcolor: '#ffffff',
              borderRadius: 2,
              border: '1px solid #e2e8f0',
            }}
          >
            <CircularProgress size={32} sx={{ color: '#1e3a5f' }} />
            <Typography sx={{ fontSize: '13px', color: '#64748b' }}>
              Fetching document activity log from server...
            </Typography>
          </Paper>
        ) : error ? (
          <Paper
            elevation={0}
            sx={{
              p: 4,
              textAlign: 'center',
              bgcolor: '#fef2f2',
              borderRadius: 2,
              border: '1px solid #fecaca',
            }}
          >
            <Typography sx={{ fontSize: '14px', fontWeight: 600, color: '#991b1b', mb: 0.5 }}>
              Could not load document activity
            </Typography>
            <Typography sx={{ fontSize: '12.5px', color: '#b91c1c', mb: 2 }}>{error}</Typography>
            <Button
              variant="outlined"
              size="small"
              onClick={fetchHistory}
              sx={{ color: '#991b1b', borderColor: '#fca5a5', textTransform: 'none' }}
            >
              Try Again
            </Button>
          </Paper>
        ) : filteredEvents.length === 0 ? (
          <Paper
            elevation={0}
            sx={{
              p: { xs: 4, sm: 6 },
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              gap: 2,
              bgcolor: '#ffffff',
              borderRadius: 2,
              border: '1px solid #e2e8f0',
            }}
          >
            <Box
              sx={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                bgcolor: '#f1f5f9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#64748b',
              }}
            >
              <HistoryIcon sx={{ fontSize: 30 }} />
            </Box>
            <Box sx={{ maxWidth: 420 }}>
              <Typography sx={{ fontSize: '15px', fontWeight: 600, color: '#0f172a' }}>
                {allEvents.length === 0 ? 'No history recorded yet' : 'No matching activity events'}
              </Typography>
              <Typography sx={{ fontSize: '13px', color: '#64748b', mt: 0.75, lineHeight: 1.5 }}>
                {allEvents.length === 0
                  ? `No pipeline or reviewer events have been recorded for this document ID (${documentId}) yet.`
                  : 'Try clearing your search keyword or phase filters above.'}
              </Typography>
            </Box>
          </Paper>
        ) : (
          <TableContainer
            component={Paper}
            elevation={0}
            sx={{
              borderRadius: 2,
              border: '1px solid #e2e8f0',
              bgcolor: '#ffffff',
              overflow: 'hidden',
            }}
          >
            <Table size="small" sx={{ minWidth: 750 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: '#f8fafc' }}>
                  <TableCell
                    sx={{
                      py: 1.25,
                      fontSize: '11.5px',
                      fontWeight: 700,
                      color: '#475569',
                      borderBottom: '1px solid #e2e8f0',
                      width: 140,
                    }}
                  >
                    Action
                  </TableCell>
                  <TableCell
                    sx={{
                      py: 1.25,
                      fontSize: '11.5px',
                      fontWeight: 700,
                      color: '#475569',
                      borderBottom: '1px solid #e2e8f0',
                      minWidth: 260,
                    }}
                  >
                    Summary
                  </TableCell>
                  <TableCell
                    sx={{
                      py: 1.25,
                      fontSize: '11.5px',
                      fontWeight: 700,
                      color: '#475569',
                      borderBottom: '1px solid #e2e8f0',
                      width: 170,
                    }}
                  >
                    Created At
                  </TableCell>
                  <TableCell
                    sx={{
                      py: 1.25,
                      fontSize: '11.5px',
                      fontWeight: 700,
                      color: '#475569',
                      borderBottom: '1px solid #e2e8f0',
                      width: 160,
                    }}
                  >
                    Document ID
                  </TableCell>
                  <TableCell
                    sx={{
                      py: 1.25,
                      fontSize: '11.5px',
                      fontWeight: 700,
                      color: '#475569',
                      borderBottom: '1px solid #e2e8f0',
                      width: 110,
                    }}
                  >
                    Actor
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredEvents.map((evt, idx) => (
                  <TableRow
                    key={evt.id || idx}
                    hover
                    sx={{
                      bgcolor: idx % 2 === 0 ? '#ffffff' : '#fafaf8',
                      '&:hover': { bgcolor: '#f1f5f9' },
                    }}
                  >
                    {/* Action */}
                    <TableCell sx={{ py: 1.25, verticalAlign: 'middle' }}>
                      <Chip
                        label={formatActionLabel(evt.action)}
                        size="small"
                        sx={{
                          height: 22,
                          fontSize: '11px',
                          fontWeight: 600,
                          ...getActionChipStyle(evt.action),
                        }}
                      />
                    </TableCell>

                    {/* Summary */}
                    <TableCell sx={{ py: 1.25, verticalAlign: 'middle' }}>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.35 }}>
                        <Typography
                          sx={{
                            fontSize: '12.5px',
                            color: '#1e293b',
                            fontWeight: 500,
                            lineHeight: 1.45,
                          }}
                        >
                          {evt.summary}
                        </Typography>
                        {evt.phaseLabel && (
                          <Typography sx={{ fontSize: '10.5px', color: '#64748b' }}>
                            Phase: {evt.phaseLabel}
                          </Typography>
                        )}
                      </Box>
                    </TableCell>

                    {/* Created At */}
                    <TableCell sx={{ py: 1.25, verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                      <Typography
                        sx={{
                          fontSize: '12px',
                          color: '#475569',
                          fontFamily: "'IBM Plex Sans', -apple-system, sans-serif",
                        }}
                      >
                        {formatTimestamp(evt.created_at)}
                      </Typography>
                    </TableCell>

                    {/* Document ID */}
                    <TableCell sx={{ py: 1.25, verticalAlign: 'middle' }}>
                      <Tooltip title={`Full Document ID: ${evt.document_id}`}>
                        <Typography
                          sx={{
                            fontSize: '11px',
                            fontFamily: 'monospace',
                            color: '#64748b',
                            bgcolor: '#f1f5f9',
                            px: 0.75,
                            py: 0.25,
                            borderRadius: 0.5,
                            display: 'inline-block',
                            maxWidth: 140,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {evt.document_id}
                        </Typography>
                      </Tooltip>
                    </TableCell>

                    {/* Actor */}
                    <TableCell sx={{ py: 1.25, verticalAlign: 'middle' }}>
                      <Chip
                        label={evt.actor}
                        size="small"
                        sx={{
                          height: 20,
                          fontSize: '10.5px',
                          fontWeight: 500,
                          bgcolor: '#f1f5f9',
                          color: '#334155',
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>
    </Box>
  );
}
