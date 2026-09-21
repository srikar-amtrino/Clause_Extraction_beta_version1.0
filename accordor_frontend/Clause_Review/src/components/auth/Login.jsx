import React, { useState } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
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
import FlashOnIcon from '@mui/icons-material/FlashOn';
import AuthLayout from './AuthLayout';
import { useAuth } from '../../context/AuthContext';

export default function Login() {
  const navigate = useNavigate();
  const { login, demoLogin, loading } = useAuth();

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    rememberMe: true,
  });

  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
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
      await login(formData.email, formData.password);
      navigate('/overview', { replace: true });
    } catch (err) {
      setErrorMsg(err.message || 'Authentication failed');
    }
  };

  const handleFillDemo = async () => {
    try {
      setFormData({
        email: 'reviewer@clausewright.com',
        password: 'password123',
        rememberMe: true,
      });
      setErrorMsg('');
      setFieldErrors({});
      await demoLogin();
      navigate('/overview', { replace: true });
    } catch (err) {
      setErrorMsg(err.message || 'Demo login failed');
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your legal reviewer workspace to continue"
    >
      {errorMsg && (
        <Alert
          severity="error"
          sx={{
            mb: 2.5,
            borderRadius: 2,
            fontSize: '0.84rem',
            alignItems: 'center',
          }}
          onClose={() => setErrorMsg('')}
        >
          {errorMsg}
        </Alert>
      )}

      <Box component="form" onSubmit={handleSubmit} noValidate>
        {/* Email Field */}
        <Box sx={{ mb: 2 }}>
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, color: '#1b1f24', mb: 0.75 }}
          >
            Email address
          </Typography>
          <TextField
            id="login-email"
            name="email"
            type="email"
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
                    <EmailOutlinedIcon sx={{ color: '#7b838c', fontSize: 20 }} />
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>

        {/* Password Field */}
        <Box sx={{ mb: 1.5 }}>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              mb: 0.75,
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600, color: '#1b1f24' }}>
              Password
            </Typography>
            <Tooltip title="For demo purposes, contact your workspace administrator" arrow>
              <Typography
                variant="caption"
                sx={{
                  color: '#1e3a5f',
                  fontWeight: 500,
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
                    <LockOutlinedIcon sx={{ color: '#7b838c', fontSize: 20 }} />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label="toggle password visibility"
                      onClick={handleTogglePassword}
                      edge="end"
                      size="small"
                      sx={{ color: '#7b838c' }}
                    >
                      {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>

        {/* Remember me */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
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
                  p: 0.5,
                }}
              />
            }
            label={
              <Typography variant="body2" sx={{ color: '#4a5159', fontSize: '0.82rem' }}>
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
            py: 1.25,
            fontSize: '0.92rem',
            fontWeight: 600,
            textTransform: 'none',
            mb: 2,
            position: 'relative',
          }}
        >
          {loading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
              <CircularProgress size={18} color="inherit" />
              <span>Authenticating...</span>
            </Box>
          ) : (
            'Sign In to Workspace'
          )}
        </Button>

        {/* Instant Demo Access Button */}
        <Button
          id="demo-login-btn"
          variant="outlined"
          fullWidth
          onClick={handleFillDemo}
          disabled={loading}
          startIcon={<FlashOnIcon sx={{ color: '#f59e0b' }} />}
          sx={{
            py: 1,
            borderColor: '#e3e3de',
            color: '#1e3a5f',
            bgcolor: '#f8fafc',
            fontSize: '0.85rem',
            fontWeight: 600,
            textTransform: 'none',
            mb: 3,
            '&:hover': {
              borderColor: '#1e3a5f',
              bgcolor: '#edf2f7',
            },
          }}
        >
          Quick Demo Sign In (1-Click)
        </Button>

        <Divider sx={{ my: 2 }}>
          <Typography variant="caption" sx={{ color: '#7b838c', px: 1 }}>
            OR
          </Typography>
        </Divider>

        {/* Switch to Signup Link */}
        <Box sx={{ textAlign: 'center', mt: 1 }}>
          <Typography variant="body2" sx={{ color: '#4a5159', fontSize: '0.86rem' }}>
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
