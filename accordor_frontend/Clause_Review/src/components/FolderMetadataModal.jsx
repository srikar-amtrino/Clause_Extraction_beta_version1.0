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
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { documentService } from '../services/documentService';

// Agreement types are fetched dynamically from GET /api/taxonomy/agreement-types/
export const AGREEMENT_TYPES = [];

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
  isLoading = false,
}) {
  const [anchorEl, setAnchorEl] = useState(null);
  const [search, setSearch] = useState('');
  const open = Boolean(anchorEl);

  const selectedItem = options.find((opt) => String(opt.id) === String(value));

  const handleOpen = (e) => {
    if (disabled || isLoading) return;
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
          bgcolor: disabled || isLoading ? '#f5f5f2' : '#ffffff',
          cursor: disabled || isLoading ? 'not-allowed' : 'pointer',
          transition: 'all 0.15s ease',
          boxShadow: open ? '0 0 0 2px rgba(30, 58, 95, 0.12)' : 'none',
          '&:hover': {
            borderColor: disabled || isLoading ? '#cfcfc8' : '#1e3a5f',
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
          {isLoading ? 'Loading...' : (selectedItem ? selectedItem.name : placeholder)}
        </Typography>
        {isLoading ? (
          <CircularProgress size={16} sx={{ color: '#7b838c', flexShrink: 0 }} />
        ) : (
          <KeyboardArrowDownIcon
            sx={{
              fontSize: 18,
              color: '#7b838c',
              transform: open ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s ease',
              flexShrink: 0,
            }}
          />
        )}
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
  const [isLoadingAgreementTypes, setIsLoadingAgreementTypes] = useState(false);

  useEffect(() => {
    if (!isOpen) return undefined;
    let active = true;
    setIsLoadingAgreementTypes(true);
    setMetadataError('');

    // Fetch agreement types dynamically from GET /api/taxonomy/agreement-types/
    documentService.agreementTypes()
      .then((data) => {
        if (!active) return;
        const rawList = Array.isArray(data)
          ? data
          : Array.isArray(data?.agreement_types)
          ? data.agreement_types
          : [];

        const agList = rawList.map((item) => {
          if (typeof item === 'object' && item !== null) {
            return {
              id: item.id !== undefined ? item.id : item.name,
              name: item.name || String(item.id),
            };
          }
          return { id: item, name: String(item) };
        });

        setAgreementTypes(agList);
        setAgreementType((current) => current || (agList[0]?.id !== undefined ? agList[0].id : ''));
      })
      .catch((error) => {
        if (!active) return;
        console.error('Failed to fetch agreement types:', error);
        setMetadataError(error.message || 'Failed to load agreement types from /api/taxonomy/agreement-types/');
        setAgreementTypes([]);
      })
      .finally(() => {
        if (active) setIsLoadingAgreementTypes(false);
      });

    // Fetch sector types from metadata
    documentService.metadata()
      .then((metadata) => {
        if (!active) return;
        const secList = Array.isArray(metadata?.sector_types) && metadata.sector_types.length > 0
          ? metadata.sector_types
          : SECTORIAL_OPTIONS.map((name, idx) => ({ id: idx + 1, name }));
        setSectorTypes(secList);
        setSectorial((current) => current || secList[0]?.id || '');
      })
      .catch((error) => {
        if (!active) return;
        console.warn('Metadata fetch warning:', error);
        const secList = SECTORIAL_OPTIONS.map((name, idx) => ({ id: idx + 1, name }));
        setSectorTypes(secList);
        setSectorial((current) => current || secList[0]?.id || '');
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
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <SearchableSelect
              label="Agreement Type"
              value={agreementType}
              onChange={(val) => setAgreementType(val)}
              options={agreementTypes}
              placeholder={isLoadingAgreementTypes ? 'Loading agreement types...' : 'Select agreement type...'}
              searchPlaceholder="Search agreement types..."
              disabled={isSaving || isLoadingAgreementTypes}
              isLoading={isLoadingAgreementTypes}
            />
            <Box
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 0.75,
                bgcolor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                p: '6px 10px',
              }}
            >
              <InfoOutlinedIcon sx={{ fontSize: 15, color: '#0284c7', mt: '1px', flexShrink: 0 }} />
              <Typography
                sx={{
                  fontSize: '11.5px',
                  color: '#475569',
                  lineHeight: 1.45,
                }}
              >
                <Box component="span" sx={{ fontWeight: 600, color: '#1e293b' }}>
                  Note:
                </Box>{' '}
                If the agreement type is not available, you should add taxonomy for that agreement type.
              </Typography>
            </Box>
          </Box>

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
            disabled={isSaving || isLoadingAgreementTypes || !agreementTypes.length || !sectorTypes.length}
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
