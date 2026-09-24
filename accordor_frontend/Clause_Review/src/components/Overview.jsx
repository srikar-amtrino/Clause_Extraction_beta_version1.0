import React from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Chip,
} from '@mui/material';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import HistoryToggleOffOutlinedIcon from '@mui/icons-material/HistoryToggleOffOutlined';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';

export default function Overview({
  driveState = {},
  stats = {},
  queueItems = [],
  onOpenPicker,
  onConnectDrive,
  _onCheckDrive,
  onNavigateToDocuments,
  onNavigateToActivityLog,
  isEmptyData = false,
  _documents = [],
}) {
  // Format current date
  const formattedDate = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  // Safe metrics computation
  const safeStats = {
    needsReview: stats?.needsReview ?? 0,
    processing: stats?.processing ?? 0,
    inReview: stats?.inReview ?? 0,
    draft: stats?.draft ?? stats?.indraft ?? 0,
    indraft: stats?.indraft ?? stats?.draft ?? 0,
    reviewed: stats?.reviewed ?? stats?.inreviewed ?? 0,
    inreviewed: stats?.inreviewed ?? stats?.reviewed ?? 0,
    updatedToVector: stats?.updatedToVector ?? 0,
  };

  const queueCount = queueItems?.length || 0;

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
      {/* Date and Summary Header */}
      <Box sx={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography
          variant="h5"
          sx={{
            fontWeight: 700,
            color: '#1b1f24',
            letterSpacing: '-0.02em',
          }}
        >
          {formattedDate}
        </Typography>
        <Typography variant="body2" sx={{ color: '#7b838c' }}>
          {!driveState.isConnected
            ? 'Connect your Google Drive account to import and review agreement clauses.'
            : isEmptyData || safeStats.needsReview === 0
            ? '0 documents from the Drive folder are waiting on a reviewer.'
            : `${safeStats.needsReview} document${safeStats.needsReview === 1 ? '' : 's'} from the Drive folder are waiting on a reviewer.`}
        </Typography>
      </Box>

      {/* Google Drive Status Banner */}
      <Paper
        elevation={0}
        sx={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          p: '14px 18px',
          bgcolor: '#ffffff',
          border: '1px solid #e3e3de',
          borderRadius: 2,
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
          flexWrap: { xs: 'wrap', md: 'nowrap' },
          gap: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75 }}>
          {/* Drive Icon Box */}
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: 1.5,
              bgcolor: '#f5f5f2',
              border: '1px solid #e3e3de',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M7.74 3.5L1.5 14.3l3.87 6.7 6.24-10.8-3.87-6.7z" fill="#0066DA" />
              <path d="M16.26 3.5H7.74l6.24 10.8h8.52l-6.24-10.8z" fill="#00AC47" />
              <path d="M22.5 14.3l-3.87-6.7-6.24 10.8h8.52l1.59-4.1z" fill="#EA4335" />
              <path d="M5.37 21h13.26l-3.87-6.7H1.5L5.37 21z" fill="#FFBA00" />
            </svg>
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#1b1f24' }}>
              {driveState.isConnected ? 'Connected to Google Drive' : 'Google Drive'}
            </Typography>
            <Box sx={{ fontSize: '12.5px', color: '#7b838c', display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
              {driveState.isConnected ? (
                driveState.folderPath ? (
                  <>
                    <span>Watching</span>
                    <Box
                      component="span"
                      sx={{
                        fontFamily: '"IBM Plex Mono", monospace',
                        fontSize: '11.5px',
                        px: 1,
                        py: 0.25,
                        bgcolor: '#f5f5f2',
                        border: '1px solid #cfcfc8',
                        borderRadius: 1,
                        color: '#4a5159',
                      }}
                    >
                      📁 {driveState.folderPath}
                    </Box>
                    {driveState.agreementType && (
                      <Chip
                        label={driveState.agreementType}
                        size="small"
                        sx={{ height: 20, fontSize: '11px', bgcolor: '#f0f4f8', color: '#1e3a5f', fontWeight: 500 }}
                      />
                    )}
                    {driveState.sectorial && (
                      <Chip
                        label={driveState.sectorial}
                        size="small"
                        sx={{ height: 20, fontSize: '11px', bgcolor: '#f5f5f2', color: '#4a5159' }}
                      />
                    )}
                    <span>— new files appear here automatically.</span>
                    {driveState.lastChecked && <span>Last checked {driveState.lastChecked}.</span>}
                  </>
                ) : (
                  <span>Connected. No folder selected yet. Click "Choose folder" to select a Google Drive folder.</span>
                )
              ) : (
                <span>Connect your Google Drive account to select folders and fetch contracts for review.</span>
              )}
            </Box>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0 }}>
          {driveState.isConnected ? (
            <>
              <Chip
                label={driveState.isSyncing ? 'Syncing' : 'Connected'}
                size="small"
                sx={{
                  bgcolor: driveState.isSyncing ? '#e6f4ea' : '#e8f0fe',
                  color: driveState.isSyncing ? '#137333' : '#1a73e8',
                  border: `1px solid ${driveState.isSyncing ? '#ceead6' : '#d2e3fc'}`,
                  fontWeight: 600,
                  fontSize: '11.5px',
                  height: 24,
                  '& .MuiChip-label': { px: 1 },
                }}
              />
              <Button
                variant="outlined"
                size="small"
                onClick={onOpenPicker}
                sx={{
                  borderColor: '#cfcfc8',
                  color: '#1b1f24',
                  fontWeight: 600,
                  fontSize: '12.5px',
                  textTransform: 'none',
                  bgcolor: '#ffffff',
                  '&:hover': { bgcolor: '#f5f5f2', borderColor: '#b9cde0' },
                }}
              >
                {driveState.folderPath ? 'Change folder' : 'Choose folder'}
              </Button>
            </>
          ) : (
            <Button
              variant="contained"
              size="small"
              onClick={onConnectDrive}
              startIcon={
                <svg width="14" height="14" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
                </svg>
              }
              sx={{
                bgcolor: '#1e3a5f',
                color: '#ffffff',
                textTransform: 'none',
                fontWeight: 600,
                fontSize: '12.5px',
                py: 0.8,
                px: 2,
              }}
            >
              Connect with Google OAuth
            </Button>
          )}
        </Box>
      </Paper>

      {/* 5 Status Metric Cards */}
      <Paper
        elevation={0}
        sx={{
          flexShrink: 0,
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(6, 1fr)' },
          bgcolor: '#ffffff',
          border: '1px solid #e3e3de',
          borderRadius: 2,
          overflow: 'hidden',
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        }}
      >
        {/* Needs review */}
        <Box sx={{ p: '16px 20px', borderRight: '1px solid #e3e3de', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#5f6368' }} />
            <Typography sx={{ fontSize: '12.5px', fontWeight: 500, color: '#4a5159' }}>
              Needs review
            </Typography>
          </Box>
          <Typography sx={{ fontSize: '26px', fontWeight: 700, color: '#1b1f24', lineHeight: 1.2, mt: 0.25 }}>
            {isEmptyData ? 0 : safeStats.needsReview}
          </Typography>
          <Typography sx={{ fontSize: '11.5px', color: '#7b838c' }}>
            waiting for reviewer
          </Typography>
        </Box>

        <Box sx={{ p: '16px 20px', borderRight: '1px solid #e3e3de', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#5f6368' }} />
            <Typography sx={{ fontSize: '12.5px', fontWeight: 500, color: '#4a5159' }}>
              Processing
            </Typography>
          </Box>
          <Typography sx={{ fontSize: '26px', fontWeight: 700, color: '#1b1f24', lineHeight: 1.2, mt: 0.25 }}>
            {isEmptyData ? 0 : safeStats.processing}
          </Typography>
          <Typography sx={{ fontSize: '11.5px', color: '#7b838c' }}>
            in progress
          </Typography>
        </Box>

        {/* In review */}
        <Box sx={{ p: '16px 20px', borderRight: '1px solid #e3e3de', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#1a73e8' }} />
            <Typography sx={{ fontSize: '12.5px', fontWeight: 500, color: '#4a5159' }}>
              In review
            </Typography>
          </Box>
          <Typography sx={{ fontSize: '26px', fontWeight: 700, color: '#1b1f24', lineHeight: 1.2, mt: 0.25 }}>
            {isEmptyData ? 0 : safeStats.inReview}
          </Typography>
          <Typography sx={{ fontSize: '11.5px', color: '#7b838c' }}>
            actively being reviewed
          </Typography>
        </Box>

        {/* Draft */}
        <Box sx={{ p: '16px 20px', borderRight: '1px solid #e3e3de', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#e37400' }} />
            <Typography sx={{ fontSize: '12.5px', fontWeight: 500, color: '#4a5159' }}>
              Draft
            </Typography>
          </Box>
          <Typography sx={{ fontSize: '26px', fontWeight: 700, color: '#1b1f24', lineHeight: 1.2, mt: 0.25 }}>
            {isEmptyData ? 0 : safeStats.indraft}
          </Typography>
          <Typography sx={{ fontSize: '11.5px', color: '#7b838c' }}>
            unsaved changes waiting
          </Typography>
        </Box>

        {/* Reviewed */}
        <Box sx={{ p: '16px 20px', borderRight: '1px solid #e3e3de', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#1e8e3e' }} />
            <Typography sx={{ fontSize: '12.5px', fontWeight: 500, color: '#4a5159' }}>
              Reviewed
            </Typography>
          </Box>
          <Typography sx={{ fontSize: '26px', fontWeight: 700, color: '#1b1f24', lineHeight: 1.2, mt: 0.25 }}>
            {isEmptyData ? 0 : safeStats.inreviewed}
          </Typography>
          <Typography sx={{ fontSize: '11.5px', color: '#7b838c' }}>
            ready to extract & export
          </Typography>
        </Box>

        {/* Updated to vector DB */}
        <Box sx={{ p: '16px 20px', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#1277a0' }} />
            <Typography sx={{ fontSize: '12.5px', fontWeight: 500, color: '#4a5159' }}>
              Updated to vector DB
            </Typography>
          </Box>
          <Typography sx={{ fontSize: '26px', fontWeight: 700, color: '#1b1f24', lineHeight: 1.2, mt: 0.25 }}>
            {isEmptyData ? 0 : safeStats.updatedToVector}
          </Typography>
          <Typography sx={{ fontSize: '11.5px', color: '#7b838c' }}>
            live in retrieval index
          </Typography>
        </Box>
      </Paper>

      {/* Split Layout: Left side = Your Queue | Right side = Activity Template */}
      <Box
        sx={{
          flexShrink: 0,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' },
          gap: 2.5,
          alignItems: 'stretch',
          width: '100%',
        }}
      >
        {/* Left Side: Your Queue Section */}
        <Paper
          elevation={0}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1.75,
            p: 2.5,
            bgcolor: '#ffffff',
            border: '1px solid #e3e3de',
            borderRadius: 2,
            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
            minWidth: 0,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#1b1f24', fontSize: '14px' }}>
                Your queue
              </Typography>
              <Chip
                label={`${queueCount} files`}
                size="small"
                sx={{
                  height: 20,
                  fontSize: '11px',
                  bgcolor: '#f5f5f2',
                  color: '#4a5159',
                  border: '1px solid #e3e3de',
                }}
              />
            </Box>

            {onNavigateToDocuments && (
              <Button
                variant="text"
                size="small"
                onClick={onNavigateToDocuments}
                endIcon={<ArrowForwardIcon sx={{ fontSize: 14 }} />}
                sx={{
                  fontSize: '12px',
                  textTransform: 'none',
                  color: '#1e3a5f',
                  fontWeight: 600,
                  p: 0,
                  '&:hover': { bgcolor: 'transparent', textDecoration: 'underline' },
                }}
              >
                Go to Documents
              </Button>
            )}
          </Box>

          <Box
            sx={{
              flex: 1,
              minHeight: 280,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              p: { xs: 3, sm: 4 },
              bgcolor: '#fafaf8',
              border: '1.5px dashed #cfcfc8',
              borderRadius: 2,
              gap: 1.5,
            }}
          >
            <Box
              sx={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                bgcolor: '#f5f5f2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#7b838c',
              }}
            >
              <AssignmentOutlinedIcon sx={{ fontSize: 26 }} />
            </Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#1b1f24', fontSize: '15px' }}>
              Your queue is empty
            </Typography>
            <Typography variant="body2" sx={{ color: '#7b838c', maxWidth: 320, lineHeight: 1.5 }}>
              No contracts are currently assigned to your review queue. Head over to <strong>Documents</strong> to inspect Google Drive files and claim them for review.
            </Typography>
            {onNavigateToDocuments && (
              <Button
                variant="contained"
                size="small"
                onClick={onNavigateToDocuments}
                startIcon={<DescriptionOutlinedIcon sx={{ fontSize: 16 }} />}
                sx={{
                  mt: 0.5,
                  bgcolor: '#1e3a5f',
                  textTransform: 'none',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  px: 2,
                  py: 0.8,
                }}
              >
                Browse Documents
              </Button>
            )}
          </Box>
        </Paper>

        {/* Right Side: Activity Template (Empty state matching Activity Log) */}
        <Paper
          elevation={0}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1.75,
            p: 2.5,
            bgcolor: '#ffffff',
            border: '1px solid #e3e3de',
            borderRadius: 2,
            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
            minWidth: 0,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#1b1f24', fontSize: '14px' }}>
                Recent activity
              </Typography>
              <Chip
                label="0 events"
                size="small"
                sx={{
                  height: 20,
                  fontSize: '11px',
                  bgcolor: '#f5f5f2',
                  color: '#4a5159',
                  border: '1px solid #e3e3de',
                }}
              />
            </Box>

            {onNavigateToActivityLog && (
              <Button
                variant="text"
                size="small"
                onClick={onNavigateToActivityLog}
                endIcon={<ArrowForwardIcon sx={{ fontSize: 14 }} />}
                sx={{
                  fontSize: '12px',
                  textTransform: 'none',
                  color: '#1e3a5f',
                  fontWeight: 600,
                  p: 0,
                  '&:hover': { bgcolor: 'transparent', textDecoration: 'underline' },
                }}
              >
                View full log
              </Button>
            )}
          </Box>

          <Box
            sx={{
              flex: 1,
              minHeight: 280,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              p: { xs: 3, sm: 4 },
              bgcolor: '#fafaf8',
              border: '1.5px dashed #cfcfc8',
              borderRadius: 2,
              gap: 1.5,
            }}
          >
            <Box
              sx={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                bgcolor: '#edf2f7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#1e3a5f',
              }}
            >
              <HistoryToggleOffOutlinedIcon sx={{ fontSize: 26 }} />
            </Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#1b1f24', fontSize: '15px' }}>
              No recent activity recorded
            </Typography>
            <Typography variant="body2" sx={{ color: '#7b838c', maxWidth: 320, lineHeight: 1.5 }}>
              Audit events will appear here as Google Drive folders are connected, documents are fetched, and legal clauses are analyzed.
            </Typography>
            {onNavigateToActivityLog && (
              <Button
                variant="outlined"
                size="small"
                onClick={onNavigateToActivityLog}
                sx={{
                  mt: 0.5,
                  borderColor: '#cfcfc8',
                  color: '#1b1f24',
                  textTransform: 'none',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  px: 2,
                  py: 0.8,
                  bgcolor: '#ffffff',
                  '&:hover': { bgcolor: '#f5f5f2', borderColor: '#1e3a5f' },
                }}
              >
                Activity Log
              </Button>
            )}
          </Box>
        </Paper>
      </Box>
    </Box>
  );
}
