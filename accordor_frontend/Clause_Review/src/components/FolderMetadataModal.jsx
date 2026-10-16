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
  MenuList,
  Button,
  IconButton,
  CircularProgress,
  Alert,
  Popover,
  InputAdornment,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import SearchIcon from '@mui/icons-material/Search';
import { documentService } from '../services/documentService';

export const AGREEMENT_TYPES = [
'Software as a Service (SaaS) Agreement',
'Software License Agreement',
'Cloud Services Agreement',
'Subscription Agreement',
'Application Programming Interface (API) Agreement',
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
'Master Service Agreement (MSA)',
'Non-Disclosure Agreement (NDA)',
'Mutual Non-Disclosure Agreement (MNDA)',
'Unilateral Non-Disclosure Agreement (UNDA)',
'Multilateral Non-Disclosure Agreement',
'Customer Non-Disclosure Agreement',
'Vendor Non-Disclosure Agreement',
'Partner Non-Disclosure Agreement',
'Employee Non-Disclosure Agreement',
'Supplier Non-Disclosure Agreement',
];

export const SECTORIAL_OPTIONS = [
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

/**
 * User-friendly Searchable Dropdown that anchors and opens strictly downwards,
 * keeping the modal dialog fully visible and providing an integrated search box.
 */
function SearchableSelect({
  label,
  value,
  onChange,
  options = [],
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  disabled = false,
}) {
  const [anchorEl, setAnchorEl] = useState(null);
  const [search, setSearch] = useState('');
  const open = Boolean(anchorEl);

  const selectedItem = options.find((opt) => String(opt.id) === String(value));

  const handleOpen = (e) => {
    if (disabled) return;
    setAnchorEl(e.currentTarget);
    setSearch('');
  };

  const handleClose = () => {
    setAnchorEl(null);
    setSearch('');
  };

  const handleSelect = (id) => {
    onChange(id);
    handleClose();
  };

  const filteredOptions = options.filter((opt) => {
    if (!search.trim()) return true;
    return (opt.name || '').toLowerCase().includes(search.toLowerCase().trim());
  });

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {label && (
        <Typography variant="body2" sx={{ fontWeight: 600, color: '#1b1f24', fontSize: '13px' }}>
          {label}
        </Typography>
      )}

      {/* Trigger Box */}
      <Box
        onClick={handleOpen}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          border: '1px solid',
          borderColor: open ? '#1e3a5f' : '#cfcfc8',
          borderRadius: '8px',
          px: 1.5,
          py: 0.9,
          bgcolor: disabled ? '#f5f5f2' : '#ffffff',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'all 0.15s ease',
          boxShadow: open ? '0 0 0 2px rgba(30, 58, 95, 0.12)' : 'none',
          '&:hover': {
            borderColor: disabled ? '#cfcfc8' : '#1e3a5f',
          },
        }}
      >
        <Typography
          sx={{
            fontSize: '13px',
            color: selectedItem ? '#1b1f24' : '#7b838c',
            fontWeight: selectedItem ? 500 : 400,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            mr: 1,
          }}
        >
          {selectedItem ? selectedItem.name : placeholder}
        </Typography>
        <KeyboardArrowDownIcon
          sx={{
            fontSize: 18,
            color: '#7b838c',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s ease',
            flexShrink: 0,
          }}
        />
      </Box>

      {/* Dropdown Menu anchored to show strictly DOWNWARDS */}
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'left',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'left',
        }}
        slotProps={{
          paper: {
            sx: {
              mt: 0.6,
              width: anchorEl ? anchorEl.clientWidth : 340,
              maxHeight: 290,
              borderRadius: '8px',
              border: '1px solid #e3e3de',
              boxShadow: '0 12px 28px rgba(0,0,0,0.14)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            },
          },
        }}
      >
        {/* Search input in dropdown */}
        <Box
          sx={{
            p: 1,
            bgcolor: '#ffffff',
            borderBottom: '1px solid #f0f0ed',
            flexShrink: 0,
          }}
        >
          <TextField
            autoFocus
            size="small"
            fullWidth
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (filteredOptions.length > 0) {
                  handleSelect(filteredOptions[0].id);
                }
              }
            }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 17, color: '#94a3b8' }} />
                  </InputAdornment>
                ),
                endAdornment: search ? (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setSearch('')} sx={{ p: 0.2 }}>
                      <CloseIcon sx={{ fontSize: 13, color: '#94a3b8' }} />
                    </IconButton>
                  </InputAdornment>
                ) : null,
              },
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                fontSize: '12.5px',
                borderRadius: '6px',
                bgcolor: '#f8fafc',
                '& fieldset': {
                  borderColor: '#e2e8f0',
                },
                '&:hover fieldset': {
                  borderColor: '#cbd5e1',
                },
                '&.Mui-focused fieldset': {
                  borderColor: '#1e3a5f',
                },
              },
            }}
          />
        </Box>

        {/* Scrollable list of items */}
        <MenuList
          sx={{
            overflowY: 'auto',
            flex: 1,
            py: 0.5,
            outline: 'none',
          }}
        >
          {filteredOptions.length === 0 ? (
            <Box sx={{ p: 2, textAlign: 'center' }}>
              <Typography sx={{ fontSize: '12px', color: '#94a3b8' }}>
                No matches found
              </Typography>
            </Box>
          ) : (
            filteredOptions.map((opt) => {
              const isSelected = String(opt.id) === String(value);
              return (
                <MenuItem
                  key={opt.id}
                  selected={isSelected}
                  onClick={() => handleSelect(opt.id)}
                  sx={{
                    fontSize: '12.5px',
                    py: 1,
                    px: 1.5,
                    whiteSpace: 'normal',
                    lineHeight: 1.35,
                    bgcolor: isSelected ? '#edf2f7 !important' : 'transparent',
                    fontWeight: isSelected ? 600 : 400,
                    color: isSelected ? '#1e3a5f' : '#1e293b',
                    '&:hover': {
                      bgcolor: '#f1f5f9 !important',
                    },
                  }}
                >
                  {opt.name}
                </MenuItem>
              );
            })
          )}
        </MenuList>
      </Popover>
    </Box>
  );
}

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
        const agList = Array.isArray(metadata?.agreement_types) && metadata.agreement_types.length > 0
          ? metadata.agreement_types
          : AGREEMENT_TYPES.map((name, idx) => ({ id: idx + 1, name }));
        const secList = Array.isArray(metadata?.sector_types) && metadata.sector_types.length > 0
          ? metadata.sector_types
          : SECTORIAL_OPTIONS.map((name, idx) => ({ id: idx + 1, name }));

        setAgreementTypes(agList);
        setSectorTypes(secList);
        setAgreementType((current) => current || agList[0]?.id || '');
        setSectorial((current) => current || secList[0]?.id || '');
        setMetadataError('');
      })
      .catch((error) => {
        if (active) {
          setMetadataError(error.message);
          const agList = AGREEMENT_TYPES.map((name, idx) => ({ id: idx + 1, name }));
          const secList = SECTORIAL_OPTIONS.map((name, idx) => ({ id: idx + 1, name }));
          setAgreementTypes(agList);
          setSectorTypes(secList);
          setAgreementType((current) => current || agList[0]?.id || '');
          setSectorial((current) => current || secList[0]?.id || '');
        }
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
        agreementTypeName: agreementTypes.find((item) => String(item.id) === String(agreementType))?.name || '',
        sectorialName: sectorTypes.find((item) => String(item.id) === String(sectorial))?.name || '',
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
          <SearchableSelect
            label="Agreement Type"
            value={agreementType}
            onChange={(val) => setAgreementType(val)}
            options={agreementTypes}
            placeholder="Select agreement type..."
            searchPlaceholder="Search agreement types..."
            disabled={isSaving}
          />

          {/* Sectorial Classification Dropdown */}
          <SearchableSelect
            label="Sectorial Category"
            value={sectorial}
            onChange={(val) => setSectorial(val)}
            options={sectorTypes}
            placeholder="Select sectorial category..."
            searchPlaceholder="Search sectorial categories..."
            disabled={isSaving}
          />
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
            disabled={isSaving || !agreementTypes.length || !sectorTypes.length}
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
