import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Avatar,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from '@mui/material';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import ArticleIcon from '@mui/icons-material/Article';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useAuth } from '../context/AuthContext';

export default function Sidebar({
  activeNav = 'overview',
  onNavSelect,
  _documentCount = 0,
  documentCount = _documentCount,
  user,
  isCollapsed = false,
  onToggleCollapse,
}) {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const handleOpenLogoutConfirm = () => {
    setShowLogoutConfirm(true);
  };

  const handleCloseLogoutConfirm = () => {
    setShowLogoutConfirm(false);
  };

  const handleConfirmLogout = () => {
    setShowLogoutConfirm(false);
    logout();
    navigate('/login', { replace: true });
  };

  const displayName =
    currentUser?.username ||
    currentUser?.name ||
    user?.name ||
    user?.username ||
    (currentUser?.email ? currentUser.email.split('@')[0] : '') ||
    (user?.email ? user.email.split('@')[0] : '') ||
    'User';
  const displayEmail = currentUser?.email || user?.email || '';
  const initial = (displayName?.[0] || displayEmail?.[0] || 'U').toUpperCase();

  return (
    <Box
      component="aside"
      sx={{
        width: isCollapsed ? 0 : 230,
        minWidth: isCollapsed ? 0 : 230,
        maxWidth: isCollapsed ? 0 : 230,
        height: '100%',
        bgcolor: '#ffffff',
        borderRight: isCollapsed ? 'none' : '1px solid #e3e3de',
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
        overflow: 'hidden',
        transition: 'width 0.22s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.22s cubic-bezier(0.4, 0, 0.2, 1), max-width 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
        visibility: isCollapsed ? 'hidden' : 'visible',
      }}
    >
      {/* Brand Header */}
      <Box
        sx={{
          p: '16px 12px 16px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid transparent',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
          <Box
            sx={{
              width: 32,
              height: 32,
              bgcolor: '#1e3a5f',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
              flexShrink: 0,
            }}
          >
            <ArticleIcon sx={{ fontSize: 18 }} />
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <Typography
              sx={{
                fontSize: '15px',
                fontWeight: 700,
                color: '#1b1f24',
                letterSpacing: '-0.2px',
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
              }}
            >
              clausereview
            </Typography>
            <Typography sx={{ fontSize: '11px', color: '#7b838c', mt: '1px', whiteSpace: 'nowrap' }}>
              Review & update
            </Typography>
          </Box>
        </Box>

        {/* Collapse to left arrow button */}
        {onToggleCollapse && (
          <Tooltip title="Collapse sidebar to left" arrow placement="right">
            <IconButton
              size="small"
              onClick={onToggleCollapse}
              sx={{
                color: '#7b838c',
                p: 0.5,
                borderRadius: 1,
                flexShrink: 0,
                '&:hover': {
                  bgcolor: '#f1f5f9',
                  color: '#1e3a5f',
                },
              }}
            >
              <ChevronLeftIcon sx={{ fontSize: 20 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Navigation Sections */}
      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          p: '12px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {/* Section: Review */}
        <Box>
          <Typography
            sx={{
              fontSize: '11px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              color: '#7b838c',
              px: 1.25,
              py: 0.5,
            }}
          >
            Review
          </Typography>
          <List disablePadding sx={{ mt: 0.5 }}>
            <ListItemButton
              selected={activeNav === 'overview'}
              onClick={() => onNavSelect && onNavSelect('overview')}
              sx={{
                borderRadius: '6px',
                py: 0.8,
                px: 1.25,
                mb: 0.5,
                '&.Mui-selected': {
                  bgcolor: '#edf2f7',
                  color: '#1e3a5f',
                  fontWeight: 600,
                  '&:hover': { bgcolor: '#e2e8f0' },
                  '& .MuiListItemIcon-root': { color: '#1e3a5f' },
                },
                '&:hover': {
                  bgcolor: '#f5f5f2',
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 28, color: '#7b838c' }}>
                <DashboardOutlinedIcon sx={{ fontSize: 18 }} />
              </ListItemIcon>
              <ListItemText
                primary="Overview"
                slotProps={{
                  primary: {
                    sx: {
                      fontSize: '13px',
                      fontWeight: activeNav === 'overview' ? 600 : 500,
                    },
                  },
                }}
              />
            </ListItemButton>

            <ListItemButton
              selected={activeNav === 'documents'}
              onClick={() => onNavSelect && onNavSelect('documents')}
              sx={{
                borderRadius: '6px',
                py: 0.8,
                px: 1.25,
                mb: 0.5,
                '&.Mui-selected': {
                  bgcolor: '#edf2f7',
                  color: '#1e3a5f',
                  fontWeight: 600,
                  '&:hover': { bgcolor: '#e2e8f0' },
                  '& .MuiListItemIcon-root': { color: '#1e3a5f' },
                },
                '&:hover': {
                  bgcolor: '#f5f5f2',
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 28, color: '#7b838c' }}>
                <DescriptionOutlinedIcon sx={{ fontSize: 18 }} />
              </ListItemIcon>
              <ListItemText
                primary="Documents"
                slotProps={{
                  primary: {
                    sx: {
                      fontSize: '13px',
                      fontWeight: activeNav === 'documents' ? 600 : 500,
                    },
                  },
                }}
              />
              {documentCount > 0 && (
                <Box
                  sx={{
                    bgcolor: activeNav === 'documents' ? '#1e3a5f' : '#f0f4f8',
                    color: activeNav === 'documents' ? '#ffffff' : '#1e3a5f',
                    fontSize: '11px',
                    fontWeight: 600,
                    px: 0.9,
                    py: 0.2,
                    borderRadius: '10px',
                    lineHeight: 1,
                  }}
                >
                  {documentCount}
                </Box>
              )}
            </ListItemButton>
          </List>
        </Box>

        {/* Section: Audit */}
        <Box>
          <Typography
            sx={{
              fontSize: '11px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              color: '#7b838c',
              px: 1.25,
              py: 0.5,
            }}
          >
            Audit
          </Typography>
          <List disablePadding sx={{ mt: 0.5 }}>
            <ListItemButton
              selected={activeNav === 'activity-log'}
              onClick={() => onNavSelect && onNavSelect('activity-log')}
              sx={{
                borderRadius: '6px',
                py: 0.8,
                px: 1.25,
                mb: 0.5,
                '&.Mui-selected': {
                  bgcolor: '#edf2f7',
                  color: '#1e3a5f',
                  fontWeight: 600,
                  '&:hover': { bgcolor: '#e2e8f0' },
                  '& .MuiListItemIcon-root': { color: '#1e3a5f' },
                },
                '&:hover': {
                  bgcolor: '#f5f5f2',
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 28, color: '#7b838c' }}>
                <HistoryOutlinedIcon sx={{ fontSize: 18 }} />
              </ListItemIcon>
              <ListItemText
                primary="Activity log"
                slotProps={{
                  primary: {
                    sx: {
                      fontSize: '13px',
                      fontWeight: activeNav === 'activity-log' ? 600 : 500,
                    },
                  },
                }}
              />
            </ListItemButton>
          </List>
        </Box>
      </Box>

      {/* Footer User Info & Logout */}
      <Box
        sx={{
          p: '14px 16px',
          borderTop: '1px solid #e3e3de',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Tooltip title={`${displayName} (${displayEmail})`} arrow placement="top">
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              flex: 1,
              minWidth: 0,
              cursor: 'default',
            }}
          >
            <Avatar
              sx={{
                width: 26,
                height: 26,
                bgcolor: '#1e3a5f',
                fontSize: '11.5px',
                fontWeight: 600,
              }}
            >
              {initial}
            </Avatar>
            <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <Typography
                sx={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#1b1f24',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {displayName}
              </Typography>
              <Typography
                sx={{
                  fontSize: '10.5px',
                  color: '#7b838c',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {displayEmail}
              </Typography>
            </Box>
          </Box>
        </Tooltip>

        <Tooltip title="Sign Out" arrow placement="top">
          <IconButton
            id="sidebar-logout-btn"
            size="small"
            onClick={handleOpenLogoutConfirm}
            sx={{
              color: '#7b838c',
              p: 0.75,
              ml: 1,
              '&:hover': {
                color: '#ef4444',
                bgcolor: 'rgba(239, 68, 68, 0.08)',
              },
            }}
          >
            <LogoutIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Logout Confirmation Dialog */}
      <Dialog
        open={showLogoutConfirm}
        onClose={handleCloseLogoutConfirm}
        PaperProps={{
          sx: {
            borderRadius: 2.5,
            p: 1,
            width: '100%',
            maxWidth: 380,
            boxShadow: '0 20px 45px -12px rgba(15, 23, 42, 0.15)',
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 700, fontSize: '1.05rem', color: '#1b1f24', pb: 0.75 }}>
          Sign Out
        </DialogTitle>
        <DialogContent sx={{ pb: 2 }}>
          <DialogContentText sx={{ color: '#4a5159', fontSize: '0.88rem', lineHeight: 1.5 }}>
            Are you sure you want to sign out of your workspace?
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 2, pb: 1.5, gap: 1 }}>
          <Button
            variant="outlined"
            size="small"
            onClick={handleCloseLogoutConfirm}
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              color: '#4a5159',
              borderColor: '#cfcfc8',
              '&:hover': { borderColor: '#9ca3af', bgcolor: '#f8fafc' },
            }}
          >
            No, Cancel
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={handleConfirmLogout}
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              bgcolor: '#dc2626',
              color: '#ffffff',
              '&:hover': { bgcolor: '#b91c1c' },
            }}
          >
            Yes, Sign Out
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
