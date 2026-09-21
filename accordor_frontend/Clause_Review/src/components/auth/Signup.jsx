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
  Divider,
  Link,
  LinearProgress,
} from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import PersonOutlinedIcon from '@mui/icons-material/PersonOutlined';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import AuthLayout from './AuthLayout';
import { useAuth } from '../../context/AuthContext';

export default function Signup() {
  const navigate = useNavigate();
  const { signup, loading } = useAuth();

  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const handleTogglePassword = () => setShowPassword((prev) => !prev);
  const handleToggleConfirmPassword = () => setShowConfirmPassword((prev) => !prev);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    if (fieldErrors[name]) {
      setFieldErrors((prev) => ({ ...prev, [name]: '' }));
    }
    if (errorMsg) {
      setErrorMsg('');
    }
  };

  // Password strength score 0 - 100
  const getPasswordStrength = (pass) => {
    if (!pass) return 0;
    let score = 0;
    if (pass.length >= 6) score += 30;
    if (pass.length >= 10) score += 20;
    if (/[A-Z]/.test(pass)) score += 20;
    if (/[0-9]/.test(pass)) score += 15;
    if (/[^A-Za-z0-9]/.test(pass)) score += 15;
    return score;
  };

  const strength = getPasswordStrength(formData.password);

  const getStrengthColor = () => {
    if (strength < 40) return '#ef4444';
    if (strength < 70) return '#f59e0b';
    return '#10b981';
  };

  const validate = () => {
    const errors = {};
    if (!formData.username.trim()) {
      errors.username = 'Username is required';
    } else if (formData.username.trim().length < 2) {
      errors.username = 'Username must be at least 2 characters';
    }

    if (!formData.email.trim()) {
      errors.email = 'Email address is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      errors.email = 'Please enter a valid email address';
    }

    if (!formData.password) {
      errors.password = 'Password is required';
    } else if (formData.password.length < 6) {
      errors.password = 'Password must be at least 6 characters';
    }

    if (!formData.confirmPassword) {
      errors.confirmPassword = 'Confirm password is required';
    } else if (formData.password !== formData.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    try {
      await signup({
        username: formData.username,
        email: formData.email,
        password: formData.password,
      });
      navigate('/overview', { replace: true });
    } catch (err) {
      setErrorMsg(err.message || 'Registration failed. Please try again.');
    }
  };

  return (
    <AuthLayout
      title="Create an account"
      subtitle="Join Clausewright to review and extract legal agreements"
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
        {/* Username Field */}
        <Box sx={{ mb: 2 }}>
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, color: '#1b1f24', mb: 0.75 }}
          >
            Username
          </Typography>
          <TextField
            id="signup-username"
            name="username"
            type="text"
            placeholder="e.g. janesmith"
            fullWidth
            value={formData.username}
            onChange={handleChange}
            error={Boolean(fieldErrors.username)}
            helperText={fieldErrors.username}
            disabled={loading}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <PersonOutlinedIcon sx={{ color: '#7b838c', fontSize: 20 }} />
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>

        {/* Email Field */}
        <Box sx={{ mb: 2 }}>
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, color: '#1b1f24', mb: 0.75 }}
          >
            Email address
          </Typography>
          <TextField
            id="signup-email"
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
        <Box sx={{ mb: formData.password ? 1 : 2 }}>
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, color: '#1b1f24', mb: 0.75 }}
          >
            Password
          </Typography>
          <TextField
            id="signup-password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            placeholder="Create a strong password (min 6 characters)"
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

        {/* Password Strength Indicator */}
        {formData.password && (
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="caption" sx={{ color: '#7b838c', fontSize: '0.74rem' }}>
                Password strength
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  color: getStrengthColor(),
                  fontWeight: 600,
                  fontSize: '0.74rem',
                }}
              >
                {strength < 40 ? 'Weak' : strength < 70 ? 'Good' : 'Strong'}
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={strength}
              sx={{
                height: 4,
                borderRadius: 2,
                backgroundColor: '#e3e3de',
                '& .MuiLinearProgress-bar': {
                  backgroundColor: getStrengthColor(),
                },
              }}
            />
          </Box>
        )}

        {/* Confirm Password Field */}
        <Box sx={{ mb: 2.5 }}>
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, color: '#1b1f24', mb: 0.75 }}
          >
            Confirm Password
          </Typography>
          <TextField
            id="signup-confirm-password"
            name="confirmPassword"
            type={showConfirmPassword ? 'text' : 'password'}
            placeholder="Re-enter your password"
            fullWidth
            value={formData.confirmPassword}
            onChange={handleChange}
            error={Boolean(fieldErrors.confirmPassword)}
            helperText={fieldErrors.confirmPassword}
            disabled={loading}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <CheckCircleOutlinedIcon
                      sx={{
                        color:
                          formData.confirmPassword && formData.password === formData.confirmPassword
                            ? '#10b981'
                            : '#7b838c',
                        fontSize: 20,
                      }}
                    />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label="toggle confirm password visibility"
                      onClick={handleToggleConfirmPassword}
                      edge="end"
                      size="small"
                      sx={{ color: '#7b838c' }}
                    >
                      {showConfirmPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>

        {/* Submit Button */}
        <Button
          id="signup-submit-btn"
          type="submit"
          variant="contained"
          fullWidth
          disabled={loading}
          sx={{
            py: 1.25,
            fontSize: '0.92rem',
            fontWeight: 600,
            textTransform: 'none',
            mb: 2.5,
          }}
        >
          {loading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
              <CircularProgress size={18} color="inherit" />
              <span>Creating your account...</span>
            </Box>
          ) : (
            'Create Reviewer Account'
          )}
        </Button>

        <Divider sx={{ my: 1.5 }} />

        {/* Switch to Login Link */}
        <Box sx={{ textAlign: 'center', mt: 1.5 }}>
          <Typography variant="body2" sx={{ color: '#4a5159', fontSize: '0.86rem' }}>
            Already have an account?{' '}
            <Link
              component={RouterLink}
              to="/login"
              sx={{
                color: '#1e3a5f',
                fontWeight: 600,
                textDecoration: 'none',
                '&:hover': { textDecoration: 'underline' },
              }}
            >
              Sign In here
            </Link>
          </Typography>
        </Box>
      </Box>
    </AuthLayout>
  );
}
