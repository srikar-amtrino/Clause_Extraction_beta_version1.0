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
  Select,
  MenuItem,
  FormControl,
  FormHelperText,
} from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import PersonOutlinedIcon from '@mui/icons-material/PersonOutlined';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import WorkOutlineIcon from '@mui/icons-material/WorkOutlined';
import AuthLayout from './AuthLayout';
import { useAuth } from '../../context/AuthContext';

const ROLES = [
  'Senior Legal Product Analyst',
  'Legal Product Analyst',
  'Senior AI Engineer',
  'AI Engineer',
  'Full Stack Developer',
];

export default function Signup() {
  const navigate = useNavigate();
  const { signup, loading } = useAuth();

  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: '',
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

    if (!formData.role) {
      errors.role = 'Please select your role';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    try {
      await signup({
        username: formData.username.trim(),
        email: formData.email.trim(),
        password: formData.password,
        role: formData.role,
      });
      // Redirect to login page, not overview page directly
      try {
        sessionStorage.setItem('clausewright_flash_signup', 'Account created successfully! Please sign in with your credentials.');
      } catch {
        /* ignore */
      }
      navigate('/login', {
        replace: true,
        state: {
          signupSuccess: true,
          registeredEmail: formData.email.trim(),
          message: 'Account created successfully! Please sign in with your credentials.',
        },
      });
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
        {/* Username Field */}
        <Box sx={{ mb: 1.2 }}>
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, color: '#1b1f24', mb: 0.35, fontSize: '0.78rem' }}
          >
            Username
          </Typography>
          <TextField
            id="signup-username"
            name="username"
            type="text"
            size="small"
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
                    <PersonOutlinedIcon sx={{ color: '#7b838c', fontSize: 18 }} />
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>

        {/* Email Field */}
        <Box sx={{ mb: 1.2 }}>
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, color: '#1b1f24', mb: 0.35, fontSize: '0.78rem' }}
          >
            Email address
          </Typography>
          <TextField
            id="signup-email"
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
        <Box sx={{ mb: formData.password ? 0.75 : 1.2 }}>
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, color: '#1b1f24', mb: 0.35, fontSize: '0.78rem' }}
          >
            Password
          </Typography>
          <TextField
            id="signup-password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            size="small"
            placeholder="Create a password (min 6 characters)"
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

        {/* Password Strength Indicator */}
        {formData.password && (
          <Box sx={{ mb: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
              <Typography variant="caption" sx={{ color: '#7b838c', fontSize: '0.7rem' }}>
                Password strength
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  color: getStrengthColor(),
                  fontWeight: 600,
                  fontSize: '0.7rem',
                }}
              >
                {strength < 40 ? 'Weak' : strength < 70 ? 'Good' : 'Strong'}
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={strength}
              sx={{
                height: 3,
                borderRadius: 1.5,
                backgroundColor: '#e3e3de',
                '& .MuiLinearProgress-bar': {
                  backgroundColor: getStrengthColor(),
                },
              }}
            />
          </Box>
        )}

        {/* Confirm Password Field */}
        <Box sx={{ mb: 1.2 }}>
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, color: '#1b1f24', mb: 0.35, fontSize: '0.78rem' }}
          >
            Confirm Password
          </Typography>
          <TextField
            id="signup-confirm-password"
            name="confirmPassword"
            type={showConfirmPassword ? 'text' : 'password'}
            size="small"
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
                        fontSize: 18,
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
                      sx={{ color: '#7b838c', p: 0.5 }}
                    >
                      {showConfirmPassword ? <VisibilityOff sx={{ fontSize: 18 }} /> : <Visibility sx={{ fontSize: 18 }} />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>

        {/* Role Dropdown */}
        <Box sx={{ mb: 1.5 }}>
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, color: '#1b1f24', mb: 0.35, fontSize: '0.78rem' }}
          >
            Role
          </Typography>
          <FormControl fullWidth size="small" error={Boolean(fieldErrors.role)}>
            <Select
              id="signup-role"
              name="role"
              value={formData.role}
              onChange={handleChange}
              disabled={loading}
              displayEmpty
              startAdornment={
                <InputAdornment position="start">
                  <WorkOutlineIcon sx={{ color: '#7b838c', fontSize: 18, ml: 0.5 }} />
                </InputAdornment>
              }
              sx={{
                fontSize: '0.85rem',
                '& .MuiSelect-select': { pl: 0.5, py: '8.5px' },
              }}
            >
              <MenuItem value="" disabled>
                <em style={{ color: '#9ca3af', fontStyle: 'normal' }}>Select your role</em>
              </MenuItem>
              {ROLES.map((r) => (
                <MenuItem key={r} value={r} sx={{ fontSize: '0.85rem' }}>
                  {r}
                </MenuItem>
              ))}
            </Select>
            {fieldErrors.role && (
              <FormHelperText>{fieldErrors.role}</FormHelperText>
            )}
          </FormControl>
        </Box>

        {/* Submit Button */}
        <Button
          id="signup-submit-btn"
          type="submit"
          variant="contained"
          fullWidth
          disabled={loading}
          sx={{
            py: 0.95,
            fontSize: '0.88rem',
            fontWeight: 600,
            textTransform: 'none',
            mb: 1.25,
          }}
        >
          {loading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={16} color="inherit" />
              <span>Creating your account...</span>
            </Box>
          ) : (
            'Create Account'
          )}
        </Button>

        <Divider sx={{ my: 1 }} />

        {/* Switch to Login Link */}
        <Box sx={{ textAlign: 'center', mt: 1 }}>
          <Typography variant="body2" sx={{ color: '#4a5159', fontSize: '0.82rem' }}>
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
