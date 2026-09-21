import React from 'react';
import { Box, Paper, Typography, Chip } from '@mui/material';
import HistoryToggleOffOutlinedIcon from '@mui/icons-material/HistoryToggleOffOutlined';
import FilterListOutlinedIcon from '@mui/icons-material/FilterListOutlined';

export default function ActivityLog() {
  const formattedDate = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

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
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography
          variant="h5"
          sx={{
            fontWeight: 700,
            color: '#1b1f24',
            letterSpacing: '-0.02em',
          }}
        >
          Activity Log
        </Typography>
        <Typography variant="body2" sx={{ color: '#7b838c' }}>
          {formattedDate} — Audit trail of document synchronization, clause extractions, and team reviews.
        </Typography>
      </Box>

      {/* Filter Chips Row */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Chip
          icon={<FilterListOutlinedIcon sx={{ fontSize: '15px !important' }} />}
          label="All Events"
          size="small"
          sx={{
            bgcolor: '#1e3a5f',
            color: '#ffffff',
            fontWeight: 600,
            fontSize: '0.78rem',
            px: 0.5,
          }}
        />
        <Chip
          label="Google Drive Syncs"
          size="small"
          variant="outlined"
          sx={{
            borderColor: '#e3e3de',
            color: '#4a5159',
            fontSize: '0.78rem',
            bgcolor: '#ffffff',
          }}
        />
        <Chip
          label="Clause Reviews"
          size="small"
          variant="outlined"
          sx={{
            borderColor: '#e3e3de',
            color: '#4a5159',
            fontSize: '0.78rem',
            bgcolor: '#ffffff',
          }}
        />
        <Chip
          label="Vector DB Updates"
          size="small"
          variant="outlined"
          sx={{
            borderColor: '#e3e3de',
            color: '#4a5159',
            fontSize: '0.78rem',
            bgcolor: '#ffffff',
          }}
        />
      </Box>

      {/* Empty State Box */}
      <Paper
        elevation={0}
        sx={{
          p: { xs: 4, sm: 6 },
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          borderRadius: 2,
          border: '1.5px dashed #cfcfc8',
          backgroundColor: '#ffffff',
          gap: 1.5,
          minHeight: 380,
        }}
      >
        <Box
          sx={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            bgcolor: '#edf2f7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#1e3a5f',
            mb: 0.5,
          }}
        >
          <HistoryToggleOffOutlinedIcon sx={{ fontSize: 28 }} />
        </Box>

        <Typography
          variant="subtitle1"
          sx={{
            fontWeight: 700,
            color: '#1b1f24',
            fontSize: '1.05rem',
          }}
        >
          No activity recorded yet
        </Typography>

        <Typography
          variant="body2"
          sx={{
            color: '#7b838c',
            maxWidth: 420,
            lineHeight: 1.55,
          }}
        >
          Audit events will automatically appear here as Google Drive folders are connected, documents are fetched, and legal clauses are analyzed and reviewed.
        </Typography>
      </Paper>
    </Box>
  );
}
