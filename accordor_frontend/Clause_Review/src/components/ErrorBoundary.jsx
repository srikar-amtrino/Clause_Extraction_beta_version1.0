import React from 'react';
import { Box, Typography, Button } from '@mui/material';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            p: 4,
            textAlign: 'center',
            bgcolor: '#ffffff',
          }}
        >
          <Box
            sx={{
              width: 52,
              height: 52,
              borderRadius: '50%',
              bgcolor: '#fee2e2',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ef4444',
              mb: 2,
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 600, color: '#1e293b', mb: 0.5 }}>
            Something went wrong loading this view
          </Typography>
          <Typography variant="body2" sx={{ color: '#64748b', maxWidth: 480, mb: 2.5 }}>
            {this.state.error?.message || 'An unexpected error occurred while rendering.'}
          </Typography>
          <Button
            variant="contained"
            onClick={this.handleReset}
            sx={{ bgcolor: '#1e3a5f', textTransform: 'none', px: 3 }}
          >
            Retry
          </Button>
        </Box>
      );
    }
    return this.props.children;
  }
}
