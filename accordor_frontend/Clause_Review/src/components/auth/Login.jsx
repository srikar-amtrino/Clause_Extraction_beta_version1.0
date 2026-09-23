import React, { useState } from 'react';
import { useNavigate, useLocation, Link as RouterLink } from 'react-router-dom';
import {
  Box,
  TextField,
  Button,
  IconButton,
  InputAdornment,
  Typography,
  Alert,
  CircularProgress,
  FormControlLabel,
  Checkbox,
  Divider,
  Link,
  Tooltip,
} from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import AuthLayout from './AuthLayout';
import { useAuth } from '../../context/AuthContext';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, loading } = useAuth();

  const [formData, setFormData] = useState({
    email: location.state?.registeredEmail || '',
    password: '',
    rememberMe: true,
  });

  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState(() => {
    try {
      const flash = sessionStorage.getItem('clausewright_flash_signup');
      if (flash) {
        sessionStorage.removeItem('clausewright_flash_signup');
        return flash;
      }
    } catch {
      /* ignore */
    }
    return location.state?.message || '';
  });
  const [fieldErrors, setFieldErrors] = useState({});

  const handleTogglePassword = () => {
    setShowPassword((prev) => !prev);
  };

  const handleChange = (e) => {
    const { name, value, checked, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
    if (fieldErrors[name]) {
      setFieldErrors((prev) => ({ ...prev, [name]: '' }));
    }
    if (errorMsg) {
      setErrorMsg('');
    }
    if (successMsg) {
      setSuccessMsg('');
    }
  };

  const validate = () => {
    const errors = {};
    if (!formData.email.trim()) {
      errors.email = 'Email address is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      errors.email = 'Please enter a valid email address';
    }

    if (!formData.password) {
      errors.password = 'Password is required';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    try {
      try {
        sessionStorage.setItem('clausewright_flash_login', 'You have logged in successfully!');
      } catch {
        /* ignore */
      }
      await login(formData.email.trim(), formData.password, formData.rememberMe);
      navigate('/overview', {
        replace: true,
        state: {
          loginSuccess: true,
          message: 'You have logged in successfully!',
        },
      });
    } catch (err) {
      try {
        sessionStorage.removeItem('clausewright_flash_login');
      } catch {
        /* ignore */
      }
      setErrorMsg(err.message || 'Authentication failed');
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your legal reviewer workspace to continue"
    >
      {successMsg && (
        <Alert
          severity="success"
          sx={{
            mb: 1.5,
            borderRadius: 1.5,
            fontSize: '0.82rem',
            py: 0.5,
            alignItems: 'center',
          }}
          onClose={() => setSuccessMsg('')}
        >
          {successMsg}
        </Alert>
      )}

      {errorMsg && (
        <Alert
          severity="error"
          sx={{
            mb: 1.5,
            borderRadius: 1.5,
            fontSize: '0.82rem',
            py: 0.5,
            alignItems: 'center',
          }}
          onClose={() => setErrorMsg('')}
        >
          {errorMsg}
        </Alert>
      )}

      <Box component="form" onSubmit={handleSubmit} noValidate>
        {/* Email Field */}
        <Box sx={{ mb: 1.5 }}>
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, color: '#1b1f24', mb: 0.35, fontSize: '0.78rem' }}
          >
            Email address
          </Typography>
          <TextField
            id="login-email"
            name="email"
            type="email"
            size="small"
            placeholder="name@organization.com"
            fullWidth
            value={formData.email}
            onChange={handleChange}
            error={Boolean(fieldErrors.email)}
            helperText={fieldErrors.email}
            disabled={loading}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <EmailOutlinedIcon sx={{ color: '#7b838c', fontSize: 18 }} />
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>

        {/* Password Field */}
        <Box sx={{ mb: 1.25 }}>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              mb: 0.35,
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600, color: '#1b1f24', fontSize: '0.78rem' }}>
              Password
            </Typography>
            <Tooltip title="Contact your workspace administrator to reset your password" arrow>
              <Typography
                variant="caption"
                sx={{
                  color: '#1e3a5f',
                  fontWeight: 500,
                  fontSize: '0.74rem',
                  cursor: 'pointer',
                  '&:hover': { textDecoration: 'underline' },
                }}
              >
                Forgot password?
              </Typography>
            </Tooltip>
          </Box>
          <TextField
            id="login-password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            size="small"
            placeholder="Enter your password"
            fullWidth
            value={formData.password}
            onChange={handleChange}
            error={Boolean(fieldErrors.password)}
            helperText={fieldErrors.password}
            disabled={loading}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <LockOutlinedIcon sx={{ color: '#7b838c', fontSize: 18 }} />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label="toggle password visibility"
                      onClick={handleTogglePassword}
                      edge="end"
                      size="small"
                      sx={{ color: '#7b838c', p: 0.5 }}
                    >
                      {showPassword ? <VisibilityOff sx={{ fontSize: 18 }} /> : <Visibility sx={{ fontSize: 18 }} />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>

        {/* Remember me */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <FormControlLabel
            control={
              <Checkbox
                name="rememberMe"
                checked={formData.rememberMe}
                onChange={handleChange}
                size="small"
                sx={{
                  color: '#cfcfc8',
                  '&.Mui-checked': { color: '#1e3a5f' },
                  p: 0.4,
                }}
              />
            }
            label={
              <Typography variant="body2" sx={{ color: '#4a5159', fontSize: '0.8rem' }}>
                Keep me signed in
              </Typography>
            }
          />
        </Box>

        {/* Submit Button */}
        <Button
          id="login-submit-btn"
          type="submit"
          variant="contained"
          fullWidth
          disabled={loading}
          sx={{
            py: 1,
            fontSize: '0.88rem',
            fontWeight: 600,
            textTransform: 'none',
            mb: 1.5,
            position: 'relative',
          }}
        >
          {loading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={16} color="inherit" />
              <span>Authenticating...</span>
            </Box>
          ) : (
            'Sign In to Workspace'
          )}
        </Button>

        <Divider sx={{ my: 1 }} />

        {/* Switch to Signup Link */}
        <Box sx={{ textAlign: 'center', mt: 1 }}>
          <Typography variant="body2" sx={{ color: '#4a5159', fontSize: '0.82rem' }}>
            Don't have an account yet?{' '}
            <Link
              component={RouterLink}
              to="/signup"
              sx={{
                color: '#1e3a5f',
                fontWeight: 600,
                textDecoration: 'none',
                '&:hover': { textDecoration: 'underline' },
              }}
            >
              Create an account
            </Link>
          </Typography>
        </Box>
      </Box>
    </AuthLayout>
  );
}
