import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  TextField,
  MenuItem,
  Button,
  IconButton,
  CircularProgress,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';

const AGREEMENT_TYPES = [
  'Master Services Agreement (MSA)',
  'Non-Disclosure Agreement (NDA)',
  'Service Level Agreement (SLA)',
  'Statement of Work (SOW)',
  'Employment Agreement',
  'Software License Agreement',
  'Vendor / Supplier Agreement',
  'Commercial Lease Agreement',
  'Data Processing Agreement (DPA)',
  'General Commercial Contract',
];

const SECTORIAL_OPTIONS = [
  'Information Technology & Software',
  'Banking, Financial Services & Insurance (BFSI)',
  'Healthcare & Life Sciences',
  'Legal & Professional Services',
  'Real Estate & Infrastructure',
  'Manufacturing & Supply Chain',
  'Energy, Oil & Utilities',
  'Retail, Consumer Goods & E-Commerce',
  'Telecommunications',
  'Cross-Sector / General',
];

export default function FolderMetadataModal({
  isOpen,
  onClose,
  folder,
  onSave,
  isSaving = false,
}) {
  const [agreementType, setAgreementType] = useState(AGREEMENT_TYPES[0]);
  const [sectorial, setSectorial] = useState(SECTORIAL_OPTIONS[0]);

  if (!isOpen || !folder) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (onSave) {
      onSave({
        folder,
        agreementType,
        sectorial,
      });
    }
  };

  return (
    <Dialog
      open={Boolean(isOpen && folder)}
      onClose={isSaving ? undefined : onClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2.5,
          border: '1px solid #e3e3de',
          boxShadow: '0 20px 35px -10px rgba(0,0,0,0.15)',
        },
      }}
    >
      <DialogTitle
        sx={{
          m: 0,
          p: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #e3e3de',
        }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#1b1f24' }}>
          Configure Selected Folder
        </Typography>
        <IconButton
          aria-label="close"
          onClick={onClose}
          disabled={isSaving}
          size="small"
          sx={{ color: '#7b838c' }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <Box component="form" onSubmit={handleSubmit}>
        <DialogContent sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Selected Folder Highlight */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              p: 1.5,
              bgcolor: '#f5f5f2',
              borderRadius: 1.5,
              border: '1px solid #e3e3de',
            }}
          >
            <Box
              sx={{
                width: 38,
                height: 38,
                borderRadius: 1,
                bgcolor: '#e8f0fe',
                color: '#1a73e8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <FolderOutlinedIcon sx={{ fontSize: 22 }} />
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="caption" sx={{ color: '#7b838c', fontWeight: 500 }}>
                Selected Google Drive Folder
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 600,
                  color: '#1b1f24',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {folder.name}
              </Typography>
            </Box>
          </Box>

          {/* Agreement Type Dropdown */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, color: '#1b1f24' }}>
              Agreement Type
            </Typography>
            <TextField
              select
              size="small"
              fullWidth
              value={agreementType}
              onChange={(e) => setAgreementType(e.target.value)}
              disabled={isSaving}
            >
              {AGREEMENT_TYPES.map((type) => (
                <MenuItem key={type} value={type} sx={{ fontSize: '13px' }}>
                  {type}
                </MenuItem>
              ))}
            </TextField>
          </Box>

          {/* Sectorial Classification Dropdown */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, color: '#1b1f24' }}>
              Sectorial Classification
            </Typography>
            <TextField
              select
              size="small"
              fullWidth
              value={sectorial}
              onChange={(e) => setSectorial(e.target.value)}
              disabled={isSaving}
            >
              {SECTORIAL_OPTIONS.map((sec) => (
                <MenuItem key={sec} value={sec} sx={{ fontSize: '13px' }}>
                  {sec}
                </MenuItem>
              ))}
            </TextField>
          </Box>
        </DialogContent>

        <DialogActions sx={{ p: 2, borderTop: '1px solid #e3e3de', bgcolor: '#f5f5f2' }}>
          <Button
            variant="outlined"
            onClick={onClose}
            disabled={isSaving}
            size="small"
            sx={{
              color: '#4a5159',
              borderColor: '#cfcfc8',
              bgcolor: '#ffffff',
              fontSize: '12.5px',
            }}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={isSaving}
            size="small"
            sx={{
              bgcolor: '#1e3a5f',
              fontSize: '12.5px',
              fontWeight: 600,
              minWidth: 100,
            }}
          >
            {isSaving ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={14} color="inherit" />
                <span>Saving...</span>
              </Box>
            ) : (
              'Save & Fetch'
            )}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
