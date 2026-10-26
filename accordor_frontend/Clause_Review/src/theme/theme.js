import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1e3a5f',
      light: '#2a5584',
      dark: '#142740',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#0f172a',
      light: '#334155',
      dark: '#020617',
      contrastText: '#ffffff',
    },
    background: {
      default: '#fafaf8',
      paper: '#ffffff',
    },
    text: {
      primary: '#1b1f24',
      secondary: '#4a5159',
    },
    divider: '#e3e3de',
    action: {
      hover: 'rgba(30, 58, 95, 0.04)',
      selected: 'rgba(30, 58, 95, 0.08)',
    },
  },
  typography: {
    fontFamily: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    h1: {
      fontFamily: '"IBM Plex Sans", sans-serif',
      fontWeight: 700,
      letterSpacing: '-0.02em',
    },
    h2: {
      fontFamily: '"IBM Plex Sans", sans-serif',
      fontWeight: 700,
      letterSpacing: '-0.015em',
    },
    h4: {
      fontFamily: '"IBM Plex Sans", sans-serif',
      fontWeight: 600,
      letterSpacing: '-0.01em',
    },
    h5: {
      fontFamily: '"IBM Plex Sans", sans-serif',
      fontWeight: 600,
      letterSpacing: '-0.01em',
    },
    h6: {
      fontFamily: '"IBM Plex Sans", sans-serif',
      fontWeight: 600,
    },
    subtitle1: {
      color: '#4a5159',
      fontSize: '0.95rem',
    },
    subtitle2: {
      color: '#7b838c',
      fontSize: '0.85rem',
    },
    body1: {
      fontSize: '0.925rem',
      color: '#1b1f24',
    },
    body2: {
      fontSize: '0.85rem',
      color: '#4a5159',
    },
    button: {
      textTransform: 'none',
      fontWeight: 600,
      letterSpacing: '0.01em',
    },
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          padding: '9px 18px',
          boxShadow: 'none',
          transition: 'all 0.18s ease-in-out',
          '&:hover': {
            boxShadow: '0 4px 12px rgba(30, 58, 95, 0.16)',
            transform: 'translateY(-1px)',
          },
          '&:active': {
            transform: 'translateY(0)',
          },
        },
        containedPrimary: {
          background: 'linear-gradient(135deg, #1e3a5f 0%, #152d4a 100%)',
          '&:hover': {
            background: 'linear-gradient(135deg, #244673 0%, #1a365a 100%)',
          },
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        variant: 'outlined',
        size: 'medium',
      },
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 8,
            backgroundColor: '#ffffff',
            transition: 'border-color 0.2s, box-shadow 0.2s',
            '& fieldset': {
              borderColor: '#e3e3de',
            },
            '&:hover fieldset': {
              borderColor: '#b9cde0',
            },
            '&.Mui-focused fieldset': {
              borderColor: '#1e3a5f',
              borderWidth: '1.5px',
            },
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
  },
});
