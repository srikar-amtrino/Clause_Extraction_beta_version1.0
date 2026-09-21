import React from 'react';
import { Box, Paper, Typography } from '@mui/material';
import SecurityIcon from '@mui/icons-material/Security';
import SyncAltIcon from '@mui/icons-material/SyncAlt';
import ArticleIcon from '@mui/icons-material/Article';

export default function AuthLayout({ children, title, subtitle }) {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        width: '100vw',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#fafaf8',
        p: { xs: 2, sm: 3, md: 4 },
        position: 'relative',
        overflow: 'auto',
      }}
    >
      {/* Background Decorative Mesh Gradients */}
      <Box
        sx={{
          position: 'fixed',
          top: '-15%',
          left: '-10%',
          width: '50vw',
          height: '50vw',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(30, 58, 95, 0.07) 0%, rgba(250, 250, 248, 0) 70%)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />
      <Box
        sx={{
          position: 'fixed',
          bottom: '-20%',
          right: '-10%',
          width: '55vw',
          height: '55vw',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(42, 97, 153, 0.06) 0%, rgba(250, 250, 248, 0) 70%)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {/* Main Elevated Container */}
      <Paper
        elevation={0}
        sx={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          maxWidth: 960,
          minHeight: 580,
          borderRadius: 3,
          border: '1px solid #e3e3de',
          boxShadow: '0 20px 45px -12px rgba(15, 23, 42, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04)',
          overflow: 'hidden',
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1.15fr' },
          backgroundColor: '#ffffff',
        }}
      >
        {/* Left Side: Brand & Feature Showcase */}
        <Box
          sx={{
            background: 'linear-gradient(155deg, #10243e 0%, #1a365d 50%, #0f1d31 100%)',
            color: '#ffffff',
            p: { xs: 3.5, sm: 4.5, md: 5 },
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Subtle background circuit pattern */}
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              opacity: 0.06,
              backgroundImage: 'radial-gradient(#ffffff 1px, transparent 1px)',
              backgroundSize: '20px 20px',
              pointerEvents: 'none',
            }}
          />

          {/* Top Branding */}
          <Box sx={{ position: 'relative', zIndex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: 1.5,
                  backgroundColor: 'rgba(255, 255, 255, 0.12)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(255, 255, 255, 0.18)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ArticleIcon sx={{ fontSize: 20, color: '#93c5fd' }} />
              </Box>
              <Box>
                <Typography
                  variant="h6"
                  sx={{
                    fontFamily: '"IBM Plex Sans", sans-serif',
                    fontWeight: 700,
                    letterSpacing: '-0.02em',
                    lineHeight: 1.1,
                    color: '#ffffff',
                  }}
                >
                  clausereview
                </Typography>
                <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.72rem' }}>
                  Workspace 
                </Typography>
              </Box>
            </Box>

            <Typography
              variant="h4"
              sx={{
                fontWeight: 700,
                lineHeight: 1.25,
                color: '#ffffff',
                mb: 1.5,
                fontSize: { xs: '1.4rem', sm: '1.75rem' },
              }}
            >
              Analyze legal clauses with precision.
            </Typography>

            <Typography
              variant="body2"
              sx={{
                color: '#cbd5e1',
                lineHeight: 1.6,
                fontSize: '0.88rem',
              }}
            >
              Streamline Google Drive document syncing, review critical agreement clauses, and index contracts seamlessly.
            </Typography>
          </Box>

          {/* Feature Highlights list */}
          <Box
            sx={{
              position: 'relative',
              zIndex: 1,
              mt: { xs: 3, md: 4 },
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box
                sx={{
                  p: 0.8,
                  borderRadius: 1,
                  bgcolor: 'rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  color: '#60a5fa',
                }}
              >
                <SyncAltIcon sx={{ fontSize: 18 }} />
              </Box>
              <Box>
                <Typography variant="subtitle2" sx={{ color: '#f8fafc', fontWeight: 600, fontSize: '0.82rem' }}>
                  Google Drive Integration
                </Typography>
                <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.73rem' }}>
                  Direct folder binding with live two-way sync
                </Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box
                sx={{
                  p: 0.8,
                  borderRadius: 1,
                  bgcolor: 'rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  color: '#34d399',
                }}
              >
                <SecurityIcon sx={{ fontSize: 18 }} />
              </Box>
              <Box>
                <Typography variant="subtitle2" sx={{ color: '#f8fafc', fontWeight: 600, fontSize: '0.82rem' }}>
                  Enterprise Role Security
                </Typography>
                <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.73rem' }}>
                  Authenticated auditor & reviewer access
                </Typography>
              </Box>
            </Box>
          </Box>

          {/* Footer note */}
          <Typography
            variant="caption"
            sx={{
              color: '#64748b',
              fontSize: '0.72rem',
              mt: 3,
              position: 'relative',
              zIndex: 1,
            }}
          >
            © 2026 Clausewright. All rights reserved.
          </Typography>
        </Box>

        {/* Right Side: Authentication Form Card */}
        <Box
          sx={{
            p: { xs: 3.5, sm: 4.5, md: 5 },
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            backgroundColor: '#ffffff',
          }}
        >
          {/* Form Header */}
          <Box sx={{ mb: 3 }}>
            <Typography
              variant="h5"
              sx={{
                fontWeight: 700,
                color: '#1b1f24',
                letterSpacing: '-0.01em',
                mb: 0.8,
              }}
            >
              {title}
            </Typography>
            <Typography variant="body2" sx={{ color: '#4a5159', lineHeight: 1.5 }}>
              {subtitle}
            </Typography>
          </Box>

          {/* Form Content */}
          {children}
        </Box>
      </Paper>
    </Box>
  );
}
