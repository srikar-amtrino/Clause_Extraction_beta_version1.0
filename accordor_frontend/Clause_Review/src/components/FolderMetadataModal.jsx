import React, { useEffect, useState } from 'react';
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
  Alert,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import { documentService } from '../services/documentService';

export const AGREEMENT_TYPES = [
  'Software as a Service Agreement (SaaS)',
  'Software License Agreement',
  'Cloud Services Agreement',
  'Information Technology (IT) Services Agreement / Master Services Agreement (MSA)',
  'Subscription Agreement',
  'Application Programming Interface (API) / Technology Integration Agreement',
  'End User License Agreement (EULA)',
  'Software Development Agreement',
  'Maintenance & Support Agreement',
  'Hosting Agreement',
  'Technology Reseller Agreement',
  'Office Lease Agreement',
  'Retail Lease Agreement',
  'Industrial Lease Agreement',
  'Commercial Lease Agreement',
  'Sublease Agreement',
  'Property Management Agreement',
  'Facilities Management Agreement',
  'Facilities Maintenance Agreement',
  'Construction Agreement',
  'Retail Supply Agreement',
  'E-Commerce Services Agreement',
  'Retail Distribution Agreement',
  'Healthcare Services Agreement / Master Services Agreement (MSA)',
  'Healthcare Provider Agreement',
  'Pharmaceutical Supply Agreement',
  'Business Associate Agreement (BAA)',
  'Manufacturing Agreement',
  'Loan Agreement',
  'Credit Facility Agreement',
  'Financial Technology (FinTech) Services Agreement',
  'Asset Management Agreement',
  'Financing Agreement',
  'Insurance Services Agreement',
  'Reinsurance Agreement',
  'Master Manufacturing Agreement',
  'Original Equipment Manufacturer (OEM) Agreement',
  'Product Supply Agreement',
  'Warehousing Agreement',
  'Third-Party Logistics (3PL) Agreement',
  'Freight Services Agreement',
  'Cold Chain Logistics Agreement',
  'Professional Services Agreement',
  'Consulting Services Agreement',
  'General Master Services Agreement (MSA)',
  'Implementation Agreement',
  'Managed Services Agreement',
  'Business Process Outsourcing (BPO) Agreement',
  'Agency Agreement',
  'Staff Augmentation Agreement',
  'Subcontractor Agreement',
  'Sales Agreement',
  'Sales Representative Agreement',
  'Distribution Agreement',
  'Channel Partner Agreement',
  'Reseller Agreement',
  'Value-Added Reseller (VAR) Agreement',
  'Referral Agreement',
  'Strategic Alliance Agreement',
  'Co-Selling Agreement',
  'Marketplace Agreement',
  'Data Processing / Data Protection Agreement (DPA)',
  'Data Sharing Agreement',
  'Data Protection Addendum',
  'Security Addendum',
  'Information Security Agreement',
  'Sub-processor Agreement',
  'Vendor Agreement',
  'Procurement Services Agreement',
  'Purchase Agreement',
  'Master Supplier Agreement',
  'Supply Agreement',
  'Contract Manufacturing Agreement',
  'Partnership / Limited Liability Company (LLC) Agreement',
  'Shareholder Agreement',
  'Investment Agreement',
  'Mergers & Acquisitions (M&A) Agreement',
  'Amendment Agreement',
  'Renewal / Extension Agreement',
  'Termination Agreement',
  'Novation Agreement',
  'Assignment Agreement',
  'Waiver Agreement',
  'Independent Contractor / Consultant Agreement',
  'Non-Compete Agreement',
  'Non-Solicitation Agreement',
  'Staffing Services Agreement',
];

export const SECTORIAL_OPTIONS = [
  // 'Information Technology & Software',
  // 'Banking, Financial Services & Insurance (BFSI)',
  // 'Healthcare & Life Sciences',
  // 'Legal & Professional Services',
  // 'Real Estate & Infrastructure',
  // 'Manufacturing & Supply Chain',
  // 'Energy, Oil & Utilities',
  // 'Retail, Consumer Goods & E-Commerce',
  // 'Telecommunications',
  // 'Cross-Sector / General',
  'IT and Technology',
  'Real Estate & Construction',
  'Retail & Consumer',
  'Healthcare & Life Sciences',
  'Banking, Financial Services & Insurance (BFSI)',
  'Manufacturing & Industrial',
  'Transportation & Logistics',
  'Professional and Consulting Services',
  'Sales and Distribution',
  'Data Privacy & Intellectual Property',
  'Procurement and Supply Chain',
  'Corporate & Commercial',
  'Contract Lifecycle',
  'Employment and HR',
];

export default function FolderMetadataModal({
  isOpen,
  onClose,
  folder,
  onSave,
  isSaving = false,
}) {
  const [agreementTypes, setAgreementTypes] = useState([]);
  const [sectorTypes, setSectorTypes] = useState([]);
  const [agreementType, setAgreementType] = useState('');
  const [sectorial, setSectorial] = useState('');
  const [metadataError, setMetadataError] = useState('');

  useEffect(() => {
    if (!isOpen) return undefined;
    let active = true;
    documentService.metadata()
      .then((metadata) => {
        if (!active) return;
        setAgreementTypes(metadata.agreement_types || []);
        setSectorTypes(metadata.sector_types || []);
        setAgreementType((current) => current || metadata.agreement_types?.[0]?.id || '');
        setSectorial((current) => current || metadata.sector_types?.[0]?.id || '');
        setMetadataError('');
      })
      .catch((error) => {
        if (active) setMetadataError(error.message);
      });
    return () => { active = false; };
  }, [isOpen]);

  if (!isOpen || !folder) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (onSave) {
      onSave({
        folder,
        agreementType,
        sectorial,
        agreementTypeName: agreementTypes.find((item) => item.id === Number(agreementType))?.name || '',
        sectorialName: sectorTypes.find((item) => item.id === Number(sectorial))?.name || '',
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
          {metadataError && <Alert severity="error">{metadataError}</Alert>}
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
              {agreementTypes.map((type) => (
                <MenuItem key={type.id} value={type.id} sx={{ fontSize: '13px' }}>
                  {type.name}
                </MenuItem>
              ))}
            </TextField>
          </Box>

          {/* Sectorial Classification Dropdown */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, color: '#1b1f24' }}>
              Sectorial Category
            </Typography>
            <TextField
              select
              size="small"
              fullWidth
              value={sectorial}
              onChange={(e) => setSectorial(e.target.value)}
              disabled={isSaving}
            >
              {sectorTypes.map((sec) => (
                <MenuItem key={sec.id} value={sec.id} sx={{ fontSize: '13px' }}>
                  {sec.name}
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
            disabled={isSaving || !agreementTypes.length || !sectorTypes.length || Boolean(metadataError)}
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
