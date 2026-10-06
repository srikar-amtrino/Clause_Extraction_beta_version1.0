import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Paper, Typography, Chip, CircularProgress, Tooltip,
  IconButton, Skeleton,
} from '@mui/material';
import HistoryToggleOffOutlinedIcon from '@mui/icons-material/HistoryToggleOffOutlined';
import FilterListOutlinedIcon from '@mui/icons-material/FilterListOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import OpenInNewOutlinedIcon from '@mui/icons-material/OpenInNewOutlined';
import { documentService } from '../services/documentService';

// Phase → colour mapping (matches the backend's 5-phase model)
const PHASE_META = {
  data_ingestion:     { label: 'Ingestion',      color: '#3b82f6', bg: '#eff6ff' },
  data_staging:       { label: 'Staging',         color: '#8b5cf6', bg: '#f5f3ff' },
  data_parsing:       { label: 'Parsing',         color: '#f59e0b', bg: '#fffbeb' },
  data_classification:{ label: 'Classification',  color: '#10b981', bg: '#ecfdf5' },
  user_interaction:   { label: 'Review',          color: '#1e3a5f', bg: '#eff4fb' },
};

// Action chip style helpers
function actionLabel(action) {
  const MAP = {
    drive_discovered:     'Drive Sync',
    parsing_started:      'Parsing Started',
    parsing_error:        'Parsing Error',
    moved_to_review:      'Ready for Review',
    classifying_started:  'Classification Started',
    classification_done:  'Classification Done',
    pipeline_queued:      'Queued',
    lock_acquired:        'Workspace Opened',
    lock_released:        'Workspace Closed',
    access_requested:     'Access Requested',
    access_granted:       'Access Granted',
    workspace_saved:      'Saved',
    published:            'Published to Vector DB',
    draft_cleaned:        'Draft Cleaned',
    chunked:              'Chunked',
  };
  return MAP[action] || action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(isoString).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// Filter chip definitions
const FILTERS = [
  { label: 'All Events',         phase: null,                    action: null },
  { label: 'Drive Syncs',        phase: 'data_ingestion',        action: null },
  { label: 'Clause Reviews',     phase: 'user_interaction',      action: null },
  { label: 'Classifications',    phase: 'data_classification',   action: null },
  { label: 'Vector DB Updates',  phase: null,                    action: 'published' },
];

function SkeletonRow() {
  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', py: 1.5, borderBottom: '1px solid #f3f3ef' }}>
      <Skeleton variant="circular" width={36} height={36} />
      <Box sx={{ flex: 1 }}>
        <Skeleton variant="text" width="60%" height={18} />
        <Skeleton variant="text" width="40%" height={14} sx={{ mt: 0.5 }} />
      </Box>
      <Skeleton variant="text" width={50} height={14} />
    </Box>
  );
}

export default function ActivityLog() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeFilter, setActiveFilter] = useState(0); // index into FILTERS

  const formattedDate = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date());

  const loadEvents = useCallback(async (filterIdx = activeFilter) => {
    setLoading(true);
    setError(null);
    try {
      const f = FILTERS[filterIdx];
      const params = { limit: 100 };
      if (f.phase)  params.phase  = f.phase;
      if (f.action) params.action = f.action;
      const res = await documentService.globalActivity(params);
      setEvents(res.events || []);
    } catch (err) {
      setError(err.message || 'Unable to load activity.');
    } finally {
      setLoading(false);
    }
  }, [activeFilter]);

  useEffect(() => { loadEvents(activeFilter); }, [activeFilter]);

  const handleFilterClick = (idx) => {
    if (idx !== activeFilter) setActiveFilter(idx);
    else loadEvents(idx);
  };

  return (
    <Box
      sx={{
        flex: 1,
        overflowY: 'auto',
        p: { xs: 2.5, sm: 3.5, md: 4.5 },
        display: 'flex',
        flexDirection: 'column',
        gap: 2.75,
        backgroundColor: '#fafaf8',
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography variant="h5" sx={{ fontWeight: 700, color: '#1b1f24', letterSpacing: '-0.02em' }}>
            Activity Log
          </Typography>
          <Typography variant="body2" sx={{ color: '#7b838c' }}>
            {formattedDate} — Audit trail of document synchronisation, clause extractions, and team reviews.
          </Typography>
        </Box>
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={() => loadEvents(activeFilter)} disabled={loading}>
            <RefreshOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Filter Chips */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <FilterListOutlinedIcon sx={{ fontSize: 18, color: '#7b838c' }} />
        {FILTERS.map((f, idx) => (
          <Chip
            key={f.label}
            label={f.label}
            size="small"
            onClick={() => handleFilterClick(idx)}
            sx={{
              cursor: 'pointer',
              fontWeight: idx === activeFilter ? 700 : 500,
              fontSize: '0.78rem',
              px: 0.5,
              ...(idx === activeFilter
                ? { bgcolor: '#1e3a5f', color: '#ffffff' }
                : { bgcolor: '#ffffff', color: '#4a5159', border: '1px solid #e3e3de' }),
            }}
          />
        ))}
      </Box>

      {/* Content area */}
      <Paper
        elevation={0}
        sx={{
          borderRadius: 2,
          border: '1px solid #e8e8e4',
          backgroundColor: '#ffffff',
          overflow: 'hidden',
        }}
      >
        {loading && events.length === 0 ? (
          <Box sx={{ p: 3 }}>
            {[...Array(6)].map((_, i) => <SkeletonRow key={i} />)}
          </Box>
        ) : error ? (
          <Box sx={{ p: 5, textAlign: 'center' }}>
            <Typography variant="body2" color="error">{error}</Typography>
          </Box>
        ) : events.length === 0 ? (
          <Box sx={{ p: { xs: 4, sm: 6 }, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 1.5, minHeight: 320 }}>
            <Box sx={{ width: 56, height: 56, borderRadius: '50%', bgcolor: '#edf2f7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1e3a5f', mb: 0.5 }}>
              <HistoryToggleOffOutlinedIcon sx={{ fontSize: 28 }} />
            </Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#1b1f24', fontSize: '1.05rem' }}>
              No activity recorded yet
            </Typography>
            <Typography variant="body2" sx={{ color: '#7b838c', maxWidth: 420, lineHeight: 1.55 }}>
              Audit events will automatically appear here as Google Drive folders are connected, documents are fetched, and legal clauses are analysed and reviewed.
            </Typography>
          </Box>
        ) : (
          <Box>
            {events.map((event, i) => {
              const pm = PHASE_META[event.phase] || { label: event.phase, color: '#6b7280', bg: '#f9fafb' };
              return (
                <Box
                  key={event.id}
                  sx={{
                    display: 'flex',
                    gap: 2,
                    alignItems: 'flex-start',
                    px: 3,
                    py: 1.75,
                    borderBottom: i < events.length - 1 ? '1px solid #f3f3ef' : 'none',
                    transition: 'background 0.15s',
                    '&:hover': { bgcolor: '#fafaf8' },
                  }}
                >
                  {/* Phase dot */}
                  <Box sx={{ width: 36, height: 36, borderRadius: '50%', bgcolor: pm.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, mt: 0.25 }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: pm.color }} />
                  </Box>

                  {/* Main content */}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Chip label={actionLabel(event.action)} size="small" sx={{ fontSize: '0.72rem', height: 20, bgcolor: pm.bg, color: pm.color, fontWeight: 600 }} />
                      <Chip label={pm.label} size="small" variant="outlined" sx={{ fontSize: '0.7rem', height: 18, borderColor: pm.color, color: pm.color }} />
                    </Box>
                    <Typography variant="body2" sx={{ mt: 0.5, color: '#3d4148', fontSize: '0.86rem', lineHeight: 1.5 }}>
                      {event.summary}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 0.5 }}>
                      {event.actor && (
                        <Typography variant="caption" sx={{ color: '#7b838c' }}>
                          by <strong>{event.actor}</strong>
                        </Typography>
                      )}
                      {event.document_name && (
                        <Typography variant="caption" sx={{ color: '#9ca3af', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          · {event.document_name}
                        </Typography>
                      )}
                    </Box>
                  </Box>

                  {/* Timestamp */}
                  <Typography variant="caption" sx={{ color: '#9ca3af', whiteSpace: 'nowrap', mt: 0.5 }}>
                    {timeAgo(event.created_at)}
                  </Typography>
                </Box>
              );
            })}
            {loading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress size={20} />
              </Box>
            )}
          </Box>
        )}
      </Paper>
    </Box>
  );
}
