import React from 'react';
import { Box, Typography, TextField, InputAdornment, Button, CircularProgress, IconButton, Tooltip } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import SyncIcon from '@mui/icons-material/Sync';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

export default function TopNav({
  title = 'Overview',
  searchQuery = '',
  onSearchChange,
  onCheckDrive,
  isCheckingDrive = false,
  isSidebarCollapsed = false,
  onToggleSidebar,
}) {
  return (
    <Box
      component="header"
      sx={{
        height: 54,
        minHeight: 54,
        bgcolor: '#ffffff',
        borderBottom: '1px solid #e3e3de',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: { xs: 2, sm: 3.5 },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {isSidebarCollapsed && onToggleSidebar && (
          <Tooltip title="Expand sidebar" arrow placement="bottom">
            <IconButton
              size="small"
              onClick={onToggleSidebar}
              sx={{
                p: 0.5,
                mr: 0.5,
                color: '#64748b',
                borderRadius: 1,
                '&:hover': { bgcolor: '#f1f5f9', color: '#1e3a5f' },
              }}
            >
              <ChevronRightIcon sx={{ fontSize: 20 }} />
            </IconButton>
          </Tooltip>
        )}
        <Typography
          variant="h6"
          sx={{
            fontSize: '15px',
            fontWeight: 600,
            color: '#1b1f24',
            textTransform: 'capitalize',
          }}
        >
          {title}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        {/* Search bar */}
        <TextField
          size="small"
          placeholder="Search documents by name, party or type"
          value={searchQuery}
          onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
          sx={{
            width: { xs: 200, sm: 280, md: 320 },
            '& .MuiOutlinedInput-root': {
              height: 34,
              fontSize: '12.5px',
              bgcolor: '#fafaf8',
              borderRadius: '6px',
              '& fieldset': { borderColor: '#e3e3de' },
              '&:hover fieldset': { borderColor: '#b9cde0' },
              '&.Mui-focused fieldset': { borderColor: '#1e3a5f' },
            },
          }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ color: '#7b838c', fontSize: 18 }} />
                </InputAdornment>
              ),
            },
          }}
        />

        {/* Check Drive Button */}
        <Button
          variant="outlined"
          size="small"
          onClick={onCheckDrive}
          disabled={isCheckingDrive}
          startIcon={
            isCheckingDrive ? (
              <CircularProgress size={14} color="inherit" />
            ) : (
              <SyncIcon sx={{ fontSize: 16 }} />
            )
          }
          sx={{
            height: 34,
            textTransform: 'none',
            fontSize: '12.5px',
            fontWeight: 500,
            borderColor: '#e3e3de',
            color: '#1b1f24',
            bgcolor: '#ffffff',
            borderRadius: '6px',
            px: 1.75,
            whiteSpace: 'nowrap',
            '&:hover': {
              borderColor: '#b9cde0',
              bgcolor: '#f5f5f2',
            },
          }}
        >
          {isCheckingDrive ? 'Checking Drive...' : 'Check Drive'}
        </Button>
      </Box>
    </Box>
  );
}
