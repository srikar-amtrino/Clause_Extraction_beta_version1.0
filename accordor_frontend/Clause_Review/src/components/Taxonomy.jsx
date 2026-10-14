import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  Chip,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  TextField,
  InputAdornment,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  MenuList,
  Popover,
  Tooltip,
  Paper,
  Tabs,
  Tab,
  Stack,
  Divider,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import CloseIcon from '@mui/icons-material/Close';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import GavelIcon from '@mui/icons-material/Gavel';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { documentService } from '../services/documentService';
import { AGREEMENT_TYPES } from './FolderMetadataModal';

// Storage key for custom / persistent taxonomy
const TAXONOMY_STORAGE_KEY = 'accordor_taxonomy_definitions_v2';

// Standard baseline taxonomy items (empty template)
const INITIAL_TAXONOMY = [];

/**
 * User-friendly Searchable Dropdown that anchors and opens strictly downwards,
 * keeping the page header and modal box visible, with integrated search.
 */
function SearchableSelect({
  label,
  value,
  onChange,
  options = [],
  placeholder = 'Select...',
  searchPlaceholder = 'Search agreement types...',
  disabled = false,
  minWidth = 240,
  fullWidth = true,
  error = false,
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
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth, width: fullWidth ? '100%' : 'auto' }}>
      {label && (
        <Typography variant="caption" sx={{ fontWeight: 600, color: error ? '#d32f2f' : '#64748b', fontSize: '12px' }}>
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
          borderColor: error ? '#d32f2f' : open ? '#1e3a5f' : '#cbd5e1',
          borderRadius: '8px',
          px: 1.5,
          py: 0.75,
          bgcolor: disabled ? '#f8fafc' : '#ffffff',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'all 0.15s ease',
          boxShadow: open ? '0 0 0 2px rgba(30, 58, 95, 0.12)' : 'none',
          '&:hover': {
            borderColor: disabled ? '#cbd5e1' : error ? '#d32f2f' : '#94a3b8',
          },
        }}
      >
        <Typography
          sx={{
            fontSize: '13px',
            color: selectedItem ? '#1e293b' : '#64748b',
            fontWeight: selectedItem && selectedItem.id !== 'ALL' ? 600 : 500,
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
            color: '#64748b',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s ease',
            flexShrink: 0,
          }}
        />
      </Box>

      {/* Dropdown Menu Popover positioned DOWN */}
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
              mt: 0.5,
              width: anchorEl ? Math.max(anchorEl.clientWidth, 320) : 320,
              maxHeight: 290,
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              boxShadow: '0 12px 28px rgba(0,0,0,0.14)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            },
          },
        }}
      >
        {/* Sticky Search Input */}
        <Box
          sx={{
            p: 1,
            bgcolor: '#ffffff',
            borderBottom: '1px solid #f1f5f9',
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

        {/* Scrollable list of items wrapped in MenuList */}
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
                    bgcolor: isSelected ? '#eff6ff !important' : 'transparent',
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

export default function Taxonomy({ showToast = () => {} }) {
  // Taxonomy items state (empty template, loaded from cache if user added items)
  const [items, setItems] = useState(() => {
    try {
      localStorage.removeItem('accordor_taxonomy_definitions_v1');
      const cached = localStorage.getItem(TAXONOMY_STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_) {}
    return INITIAL_TAXONOMY;
  });

  // Filter states
  const [agreementFilter, setAgreementFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('all'); // 'all', 'clauses', 'non_clauses'
  const [searchQuery, setSearchQuery] = useState('');

  // Modal / Popup state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create'); // 'create' | 'edit'
  const [editingId, setEditingId] = useState(null);

  // Modal Form State with the requested fields:
  // "applies_to", "number", "key", "name", "definition", "aliases", "excludes"
  const [formData, setFormData] = useState({
    category: 'clause', // 'clause' | 'non_clause'
    applies_to: 'All Agreements',
    number: '',
    key: '',
    name: '',
    definition: '',
    aliases: '',
    excludes: '',
  });

  const [formErrors, setFormErrors] = useState({});
  const fileInputRef = useRef(null);

  // Sync items to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(TAXONOMY_STORAGE_KEY, JSON.stringify(items));
    } catch (_) {}
  }, [items]);



  // Compute stats
  const stats = useMemo(() => {
    const clauseCount = items.filter((i) => i.category === 'clause').length;
    const nonClauseCount = items.filter((i) => i.category === 'non_clause').length;
    const uniqueAppliesTo = new Set(items.map((i) => i.applies_to).filter(Boolean)).size;
    return {
      total: items.length,
      clauses: clauseCount,
      nonClauses: nonClauseCount,
      agreements: uniqueAppliesTo,
    };
  }, [items]);

  // Filtered taxonomy list
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // 1. Agreement Type Filter
      if (agreementFilter !== 'ALL') {
        const itemApplies = (item.applies_to || '').toLowerCase();
        const target = agreementFilter.toLowerCase();
        if (itemApplies !== 'all' && itemApplies !== 'all agreements' && !itemApplies.includes(target) && !target.includes(itemApplies)) {
          return false;
        }
      }

      // 2. Category Filter (Clauses vs Non-Clauses)
      if (categoryFilter === 'clauses' && item.category !== 'clause') {
        return false;
      }
      if (categoryFilter === 'non_clauses' && item.category !== 'non_clause') {
        return false;
      }

      // 3. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = (item.name || '').toLowerCase().includes(q);
        const matchKey = (item.key || '').toLowerCase().includes(q);
        const matchNumber = (item.number || '').toLowerCase().includes(q);
        const matchDef = (item.definition || '').toLowerCase().includes(q);
        const matchAliases = (item.aliases || '').toLowerCase().includes(q);
        const matchApplies = (item.applies_to || '').toLowerCase().includes(q);
        if (!matchName && !matchKey && !matchNumber && !matchDef && !matchAliases && !matchApplies) {
          return false;
        }
      }

      return true;
    });
  }, [items, agreementFilter, categoryFilter, searchQuery]);

  // Open Modal to Add New item
  const handleOpenAddModal = (presetCategory = null) => {
    // If a specific category is requested, use it; otherwise infer from categoryFilter
    const cat = presetCategory
      ? presetCategory
      : categoryFilter === 'non_clauses'
      ? 'non_clause'
      : 'clause';

    // Auto-compute next number suggestion
    const categoryItems = items.filter((i) => i.category === cat);
    const nextNum = cat === 'clause' ? `${categoryItems.length + 1}.0` : `0.${categoryItems.length + 1}`;

    setModalMode('create');
    setEditingId(null);
    setFormErrors({});
    setFormData({
      category: cat,
      applies_to: agreementFilter !== 'ALL' ? agreementFilter : 'All Agreements',
      number: nextNum,
      key: '',
      name: '',
      definition: '',
      aliases: '',
      excludes: '',
    });
    setIsModalOpen(true);
  };

  // Open Modal to Edit existing item
  const handleOpenEditModal = (item) => {
    setModalMode('edit');
    setEditingId(item.id);
    setFormErrors({});
    setFormData({
      category: item.category || 'clause',
      applies_to: item.applies_to || 'All Agreements',
      number: item.number || '',
      key: item.key || '',
      name: item.name || '',
      definition: item.definition || '',
      aliases: item.aliases || '',
      excludes: item.excludes || '',
    });
    setIsModalOpen(true);
  };

  // Close modal
  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setFormErrors({});
  };

  // Form input change
  const handleFormChange = (field, value) => {
    setFormData((prev) => {
      const next = { ...prev, [field]: value };
      // Auto-generate key from name if key is empty or touched
      if (field === 'name' && modalMode === 'create' && (!prev.key || prev.key === prev.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'))) {
        next.key = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_');
      }
      return next;
    });
    if (formErrors[field]) {
      setFormErrors((prev) => ({ ...prev, [field]: null }));
    }
  };

  // Save Modal Form
  const handleSaveItem = () => {
    const errors = {};
    if (!formData.name?.trim()) {
      errors.name = 'Name is required';
    }
    if (!formData.key?.trim()) {
      errors.key = 'Key identifier is required';
    }
    if (!formData.applies_to?.trim()) {
      errors.applies_to = 'Applies To is required';
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    const cleanedKey = formData.key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const newItemData = {
      ...formData,
      key: cleanedKey,
      name: formData.name.trim(),
      number: formData.number.trim() || '1.0',
      applies_to: formData.applies_to.trim(),
      definition: formData.definition.trim(),
      aliases: formData.aliases.trim(),
      excludes: formData.excludes.trim(),
    };

    if (modalMode === 'create') {
      const newEntry = {
        id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        ...newItemData,
      };
      setItems((prev) => [newEntry, ...prev]);
      showToast(`Added taxonomy definition "${newEntry.name}"`, 'success');
    } else {
      setItems((prev) =>
        prev.map((item) => (item.id === editingId ? { ...item, ...newItemData } : item))
      );
      showToast(`Updated taxonomy definition "${newItemData.name}"`, 'success');
    }

    handleCloseModal();
  };

  // Delete an item
  const handleDeleteItem = (id, name) => {
    if (window.confirm(`Are you sure you want to remove "${name}" from taxonomy?`)) {
      setItems((prev) => prev.filter((i) => i.id !== id));
      showToast(`Removed "${name}" from taxonomy`, 'info');
    }
  };

  // Copy Key to Clipboard
  const handleCopyKey = (key) => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(key);
      showToast(`Copied key "${key}" to clipboard`, 'success');
    }
  };

  // File Upload Handler (JSON, CSV, or Text)
  const handleUploadClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target.result;
        let imported = [];

        if (file.name.endsWith('.json')) {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            imported = parsed;
          } else if (parsed && typeof parsed === 'object') {
            const clauses = Array.isArray(parsed.clauses) || Array.isArray(parsed.clause_types)
              ? (parsed.clauses || parsed.clause_types).map((c) => ({ ...c, category: 'clause' }))
              : [];
            const nonClauses = Array.isArray(parsed.non_clauses) || Array.isArray(parsed.non_clause_types)
              ? (parsed.non_clauses || parsed.non_clause_types).map((nc) => ({ ...nc, category: 'non_clause' }))
              : [];
            imported = [...clauses, ...nonClauses];
          }
        } else if (file.name.endsWith('.csv')) {
          // Simple CSV parser
          const lines = content.split(/\r?\n/).filter(Boolean);
          if (lines.length > 1) {
            const header = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/"/g, ''));
            for (let i = 1; i < lines.length; i++) {
              const row = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
              const obj = {};
              header.forEach((h, idx) => {
                obj[h] = row[idx] || '';
              });
              if (obj.name || obj.key) {
                imported.push(obj);
              }
            }
          }
        }

        if (imported.length === 0) {
          showToast('No valid taxonomy entries found in uploaded file.', 'error');
          return;
        }

        const normalizedImported = imported.map((item, idx) => ({
          id: `upload-${Date.now()}-${idx}`,
          category: item.category === 'non_clause' || item.type === 'non_clause' ? 'non_clause' : 'clause',
          applies_to: item.applies_to || item.agreement_type || 'All Agreements',
          number: item.number || `${idx + 1}.0`,
          key: (item.key || item.name || `entry_${idx}`).toLowerCase().replace(/[^a-z0-9_]/g, '_'),
          name: item.name || item.key || `Imported Item ${idx + 1}`,
          definition: item.definition || '',
          aliases: Array.isArray(item.aliases) ? item.aliases.join(', ') : item.aliases || '',
          excludes: Array.isArray(item.excludes) ? item.excludes.join(', ') : item.excludes || '',
        }));

        setItems((prev) => {
          const existingKeys = new Set(prev.map((i) => (i.key || '').toLowerCase().trim()));
          const newEntries = normalizedImported.filter((ni) => !existingKeys.has(ni.key));
          const updated = [...newEntries, ...prev];
          return updated;
        });

        showToast(`Successfully uploaded ${normalizedImported.length} taxonomy entries!`, 'success');
      } catch (err) {
        console.error('File parse error:', err);
        showToast(`Failed to parse file: ${err.message}`, 'error');
      }
    };
    reader.readAsText(file);
  };

  // Export Taxonomy as JSON
  const handleExportJSON = () => {
    try {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(items, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', `accordor_taxonomy_${new Date().toISOString().slice(0, 10)}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      showToast('Taxonomy JSON exported successfully', 'success');
    } catch (_) {}
  };

  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        bgcolor: '#fafaf8',
        overflow: 'hidden',
      }}
    >
      {/* Hidden File Input for Upload */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept=".json,.csv,.txt"
        style={{ display: 'none' }}
      />

      {/* Top Banner / Stats Header */}
      <Box
        sx={{
          p: '20px 28px 16px 28px',
          bgcolor: '#ffffff',
          borderBottom: '1px solid #e3e3de',
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          alignItems: { xs: 'flex-start', md: 'center' },
          justifyContent: 'space-between',
          gap: 2,
        }}
      >
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: '8px',
                bgcolor: '#edf2f7',
                color: '#1e3a5f',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AccountTreeOutlinedIcon sx={{ fontSize: 20 }} />
            </Box>
            <Typography
              variant="h5"
              sx={{
                fontWeight: 700,
                color: '#1b1f24',
                fontSize: '22px',
                letterSpacing: '-0.3px',
              }}
            >
              Contract Taxonomy
            </Typography>
            <Chip
              label={`${stats.total} Definitions`}
              size="small"
              sx={{
                bgcolor: '#1e3a5f',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: '11px',
                height: 22,
              }}
            />
          </Box>
          <Typography sx={{ fontSize: '13px', color: '#64748b' }}>
            Standard definitions, applies-to agreement rules, clause recognition parameters, and exclusion criteria.
          </Typography>
        </Box>

        {/* Right side Actions: Upload File & Export */}
        <Stack direction="row" spacing={1.5} alignItems="center">

          {/* User Request: Upload file button in right side */}
          <Button
            variant="contained"
            size="small"
            startIcon={<UploadFileOutlinedIcon sx={{ fontSize: 18 }} />}
            onClick={handleUploadClick}
            sx={{
              textTransform: 'none',
              fontSize: '13px',
              fontWeight: 600,
              bgcolor: '#1e3a5f',
              color: '#ffffff',
              borderRadius: '8px',
              px: 2,
              py: 0.8,
              boxShadow: '0 1px 3px rgba(30, 58, 95, 0.2)',
              '&:hover': {
                bgcolor: '#152943',
              },
            }}
          >
            Upload File
          </Button>
        </Stack>
      </Box>

      {/* Filter Toolbar: Three filters (Agreement Type, Non Clauses, and Clauses) */}
      <Box
        sx={{
          p: '14px 28px',
          bgcolor: '#ffffff',
          borderBottom: '1px solid #e3e3de',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
        }}
      >
        {/* Left Side: Three Filters + Add Buttons */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
          {/* Filter 1: Agreement Type Dropdown with Search */}
          <SearchableSelect
            value={agreementFilter}
            onChange={(val) => setAgreementFilter(val)}
            options={[
              { id: 'ALL', name: `All Agreement Types (${stats.total})` },
              ...AGREEMENT_TYPES.map((type) => ({ id: type, name: type })),
            ]}
            minWidth={250}
            fullWidth={false}
            searchPlaceholder="Search agreement types..."
          />

          {/* Filter 2 & 3: Clauses and Non-Clauses Tabs/Pills */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              bgcolor: '#f1f5f9',
              p: '3px',
              borderRadius: '9px',
              border: '1px solid #e2e8f0',
            }}
          >
            <Button
              size="small"
              onClick={() => setCategoryFilter('all')}
              sx={{
                textTransform: 'none',
                fontSize: '12px',
                fontWeight: categoryFilter === 'all' ? 700 : 500,
                color: categoryFilter === 'all' ? '#1e3a5f' : '#64748b',
                bgcolor: categoryFilter === 'all' ? '#ffffff' : 'transparent',
                boxShadow: categoryFilter === 'all' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                borderRadius: '7px',
                px: 1.5,
                py: 0.5,
                minWidth: 'auto',
                '&:hover': {
                  bgcolor: categoryFilter === 'all' ? '#ffffff' : 'rgba(0,0,0,0.03)',
                },
              }}
            >
              All ({stats.total})
            </Button>

            {/* Filter: Clauses */}
            <Button
              size="small"
              onClick={() => setCategoryFilter('clauses')}
              sx={{
                textTransform: 'none',
                fontSize: '12px',
                fontWeight: categoryFilter === 'clauses' ? 700 : 500,
                color: categoryFilter === 'clauses' ? '#1e3a5f' : '#64748b',
                bgcolor: categoryFilter === 'clauses' ? '#ffffff' : 'transparent',
                boxShadow: categoryFilter === 'clauses' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                borderRadius: '7px',
                px: 1.5,
                py: 0.5,
                minWidth: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 0.8,
                '&:hover': {
                  bgcolor: categoryFilter === 'clauses' ? '#ffffff' : 'rgba(0,0,0,0.03)',
                },
              }}
            >
              <GavelIcon sx={{ fontSize: 14 }} />
              Clauses ({stats.clauses})
            </Button>

            {/* Filter: Non Clauses */}
            <Button
              size="small"
              onClick={() => setCategoryFilter('non_clauses')}
              sx={{
                textTransform: 'none',
                fontSize: '12px',
                fontWeight: categoryFilter === 'non_clauses' ? 700 : 500,
                color: categoryFilter === 'non_clauses' ? '#1e3a5f' : '#64748b',
                bgcolor: categoryFilter === 'non_clauses' ? '#ffffff' : 'transparent',
                boxShadow: categoryFilter === 'non_clauses' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                borderRadius: '7px',
                px: 1.5,
                py: 0.5,
                minWidth: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 0.8,
                '&:hover': {
                  bgcolor: categoryFilter === 'non_clauses' ? '#ffffff' : 'rgba(0,0,0,0.03)',
                },
              }}
            >
              <ArticleOutlinedIcon sx={{ fontSize: 14 }} />
              Non Clauses ({stats.nonClauses})
            </Button>
          </Box>

          {/* User Request: in non clauses and clauses filter i want a add button with + symbol */}
          <Stack direction="row" spacing={1} alignItems="center">
            {/* Add Clause Button */}
            <Tooltip title="Add new Clause taxonomy definition" arrow>
              <Button
                variant="outlined"
                size="small"
                startIcon={<AddIcon sx={{ fontSize: 17 }} />}
                onClick={() => handleOpenAddModal('clause')}
                sx={{
                  textTransform: 'none',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#1e3a5f',
                  borderColor: '#93c5fd',
                  bgcolor: '#eff6ff',
                  borderRadius: '8px',
                  px: 1.4,
                  py: 0.6,
                  '&:hover': {
                    bgcolor: '#dbeafe',
                    borderColor: '#60a5fa',
                  },
                }}
              >
                Add Clause
              </Button>
            </Tooltip>

            {/* Add Non-Clause Button */}
            <Tooltip title="Add new Non-Clause taxonomy definition" arrow>
              <Button
                variant="outlined"
                size="small"
                startIcon={<AddIcon sx={{ fontSize: 17 }} />}
                onClick={() => handleOpenAddModal('non_clause')}
                sx={{
                  textTransform: 'none',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#92400e',
                  borderColor: '#fde68a',
                  bgcolor: '#fefce8',
                  borderRadius: '8px',
                  px: 1.4,
                  py: 0.6,
                  '&:hover': {
                    bgcolor: '#fef08a',
                    borderColor: '#f59e0b',
                  },
                }}
              >
                Add Non-Clause
              </Button>
            </Tooltip>
          </Stack>
        </Box>

        {/* Right Side: Search Box */}
        <Box sx={{ width: { xs: '100%', sm: 260 } }}>
          <TextField
            placeholder="Search taxonomy..."
            size="small"
            fullWidth
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: '#94a3b8', fontSize: 18 }} />
                  </InputAdornment>
                ),
                endAdornment: searchQuery && (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setSearchQuery('')}>
                      <CloseIcon sx={{ fontSize: 15 }} />
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                bgcolor: '#f8fafc',
                borderRadius: '8px',
                fontSize: '13px',
                '& fieldset': { borderColor: '#cbd5e1' },
                '&:hover fieldset': { borderColor: '#94a3b8' },
              },
            }}
          />
        </Box>
      </Box>

      {/* Main Content: Taxonomy Table */}
      <Box sx={{ flex: 1, p: '20px 28px', overflowY: 'auto' }}>
        <Paper
          elevation={0}
          sx={{
            border: '1px solid #e3e3de',
            borderRadius: '10px',
            overflow: 'hidden',
            bgcolor: '#ffffff',
          }}
        >
          <TableContainer sx={{ maxHeight: 'calc(100vh - 270px)' }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow sx={{ '& th': { bgcolor: '#f8fafc', fontWeight: 700, fontSize: '12px', color: '#475569', py: 1.2 } }}>
                  <TableCell width="70">No.</TableCell>
                  <TableCell width="240">Name & Key</TableCell>
                  <TableCell width="120">Category</TableCell>
                  <TableCell width="200">Applies To</TableCell>
                  <TableCell>Definition</TableCell>
                  <TableCell width="220">Aliases & Excludes</TableCell>
                  <TableCell width="70" align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} sx={{ py: 8, textAlign: 'center' }}>
                      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
                        <AccountTreeOutlinedIcon sx={{ fontSize: 44, color: '#94a3b8' }} />
                        <Typography sx={{ fontSize: '15px', fontWeight: 600, color: '#334155' }}>
                          {items.length === 0 ? 'Taxonomy is empty' : 'No taxonomy definitions match your filter'}
                        </Typography>
                        <Typography sx={{ fontSize: '13px', color: '#64748b', maxWidth: 420 }}>
                          {items.length === 0
                            ? 'Click "Add Clause" or "Add Non-Clause" to register definitions, or use "Upload File" to import taxonomy definitions.'
                            : 'Try choosing another agreement type, resetting your search term, or click the + Add button to register a new clause or non-clause definition.'}
                        </Typography>
                        <Button
                          variant="contained"
                          size="small"
                          startIcon={<AddIcon />}
                          onClick={() => handleOpenAddModal()}
                          sx={{
                            mt: 1,
                            bgcolor: '#1e3a5f',
                            textTransform: 'none',
                            borderRadius: '8px',
                          }}
                        >
                          Add Taxonomy Entry
                        </Button>
                      </Box>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredItems.map((item) => {
                    const isClause = item.category === 'clause';
                    return (
                      <TableRow
                        key={item.id}
                        hover
                        sx={{
                          '&:hover': { bgcolor: '#fbfcfd' },
                          '& td': { py: 1.4, borderColor: '#f1f5f9' },
                        }}
                      >
                        {/* Number */}
                        <TableCell>
                          <Typography
                            sx={{
                              fontSize: '12px',
                              fontWeight: 700,
                              color: '#64748b',
                              fontFamily: 'monospace',
                            }}
                          >
                            {item.number || '—'}
                          </Typography>
                        </TableCell>

                        {/* Name & Key */}
                        <TableCell>
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
                            <Typography sx={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>
                              {item.name}
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Typography
                                sx={{
                                  fontSize: '11px',
                                  fontFamily: 'monospace',
                                  color: '#2563eb',
                                  bgcolor: '#eff6ff',
                                  px: 0.8,
                                  py: 0.1,
                                  borderRadius: '4px',
                                  border: '1px solid #dbeafe',
                                  display: 'inline-block',
                                }}
                              >
                                {item.key}
                              </Typography>
                              <Tooltip title="Copy key" arrow>
                                <IconButton
                                  size="small"
                                  onClick={() => handleCopyKey(item.key)}
                                  sx={{ p: 0.2, color: '#94a3b8', '&:hover': { color: '#2563eb' } }}
                                >
                                  <ContentCopyIcon sx={{ fontSize: 12 }} />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          </Box>
                        </TableCell>

                        {/* Category */}
                        <TableCell>
                          <Chip
                            label={isClause ? 'Clause' : 'Non-Clause'}
                            size="small"
                            sx={{
                              fontSize: '11px',
                              fontWeight: 600,
                              height: 22,
                              bgcolor: isClause ? '#e0f2fe' : '#fef3c7',
                              color: isClause ? '#0369a1' : '#b45309',
                              border: `1px solid ${isClause ? '#bae6fd' : '#fde68a'}`,
                            }}
                          />
                        </TableCell>

                        {/* Applies To */}
                        <TableCell>
                          <Chip
                            label={item.applies_to || 'All Agreements'}
                            size="small"
                            sx={{
                              fontSize: '11px',
                              fontWeight: 500,
                              height: 22,
                              maxWidth: 190,
                              bgcolor: '#f1f5f9',
                              color: '#334155',
                              border: '1px solid #e2e8f0',
                            }}
                          />
                        </TableCell>

                        {/* Definition */}
                        <TableCell>
                          <Typography
                            sx={{
                              fontSize: '12.5px',
                              color: '#334155',
                              lineHeight: 1.45,
                              maxHeight: '4.5em',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              display: '-webkit-box',
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: 'vertical',
                            }}
                          >
                            {item.definition || '—'}
                          </Typography>
                        </TableCell>

                        {/* Aliases & Excludes */}
                        <TableCell>
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
                            {item.aliases && (
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                                <Typography sx={{ fontSize: '10.5px', fontWeight: 600, color: '#64748b', minWidth: 42 }}>
                                  Alias:
                                </Typography>
                                <Typography
                                  sx={{
                                    fontSize: '11px',
                                    color: '#475569',
                                    bgcolor: '#f8fafc',
                                    p: '1px 5px',
                                    borderRadius: '4px',
                                    border: '1px solid #e2e8f0',
                                    lineHeight: 1.3,
                                  }}
                                >
                                  {item.aliases}
                                </Typography>
                              </Box>
                            )}
                            {item.excludes && (
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                                <Typography sx={{ fontSize: '10.5px', fontWeight: 600, color: '#dc2626', minWidth: 42 }}>
                                  Excl:
                                </Typography>
                                <Typography
                                  sx={{
                                    fontSize: '11px',
                                    color: '#b91c1c',
                                    bgcolor: '#fef2f2',
                                    p: '1px 5px',
                                    borderRadius: '4px',
                                    border: '1px solid #fee2e2',
                                    lineHeight: 1.3,
                                  }}
                                >
                                  {item.excludes}
                                </Typography>
                              </Box>
                            )}
                            {!item.aliases && !item.excludes && (
                              <Typography sx={{ fontSize: '11px', color: '#94a3b8' }}>None specified</Typography>
                            )}
                          </Box>
                        </TableCell>

                        {/* Actions */}
                        <TableCell align="right">
                          <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                            <Tooltip title="Edit" arrow>
                              <IconButton
                                size="small"
                                onClick={() => handleOpenEditModal(item)}
                                sx={{ color: '#64748b', '&:hover': { color: '#1e3a5f', bgcolor: '#f1f5f9' } }}
                              >
                                <EditOutlinedIcon sx={{ fontSize: 16 }} />
                              </IconButton>
                            </Tooltip>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Box>

      {/* =========================================================================
          User Request Modal:
          Fields:
            "applies_to":
            "number":
            "key":
            "name":
            "definition":
            "aliases":
            "excludes":
          and a save button
         ========================================================================= */}
      <Dialog
        open={isModalOpen}
        onClose={handleCloseModal}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '12px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
          },
        }}
      >
        <DialogTitle
          sx={{
            p: '20px 24px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #e2e8f0',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: '8px',
                bgcolor: formData.category === 'clause' ? '#eff6ff' : '#fefce8',
                color: formData.category === 'clause' ? '#1e3a5f' : '#b45309',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {formData.category === 'clause' ? (
                <GavelIcon sx={{ fontSize: 18 }} />
              ) : (
                <ArticleOutlinedIcon sx={{ fontSize: 18 }} />
              )}
            </Box>
            <Box>
              <Typography sx={{ fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
                {modalMode === 'create' ? 'Add Taxonomy Definition' : 'Edit Taxonomy Definition'}
              </Typography>
              <Typography sx={{ fontSize: '12px', color: '#64748b' }}>
                Define clause classification criteria and parsing rules
              </Typography>
            </Box>
          </Box>
          <IconButton size="small" onClick={handleCloseModal} sx={{ color: '#94a3b8' }}>
            <CloseIcon sx={{ fontSize: 20 }} />
          </IconButton>
        </DialogTitle>

        <DialogContent sx={{ p: '24px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Category Selector */}
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              size="small"
              variant={formData.category === 'clause' ? 'contained' : 'outlined'}
              onClick={() => handleFormChange('category', 'clause')}
              sx={{
                flex: 1,
                textTransform: 'none',
                fontWeight: 600,
                fontSize: '12.5px',
                borderRadius: '8px',
                bgcolor: formData.category === 'clause' ? '#1e3a5f' : 'transparent',
                borderColor: formData.category === 'clause' ? '#1e3a5f' : '#cbd5e1',
                color: formData.category === 'clause' ? '#ffffff' : '#475569',
                '&:hover': {
                  bgcolor: formData.category === 'clause' ? '#152943' : '#f8fafc',
                },
              }}
            >
              Clause Taxonomy
            </Button>
            <Button
              size="small"
              variant={formData.category === 'non_clause' ? 'contained' : 'outlined'}
              onClick={() => handleFormChange('category', 'non_clause')}
              sx={{
                flex: 1,
                textTransform: 'none',
                fontWeight: 600,
                fontSize: '12.5px',
                borderRadius: '8px',
                bgcolor: formData.category === 'non_clause' ? '#b45309' : 'transparent',
                borderColor: formData.category === 'non_clause' ? '#b45309' : '#cbd5e1',
                color: formData.category === 'non_clause' ? '#ffffff' : '#475569',
                '&:hover': {
                  bgcolor: formData.category === 'non_clause' ? '#92400e' : '#f8fafc',
                },
              }}
            >
              Non-Clause Taxonomy
            </Button>
          </Box>

          {/* Row 1: applies_to and number */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 2, alignItems: 'flex-start' }}>
            {/* Field: applies_to */}
            <SearchableSelect
              label="applies_to *"
              value={formData.applies_to}
              onChange={(val) => handleFormChange('applies_to', val)}
              options={[
                { id: 'All Agreements', name: 'All Agreements' },
                ...AGREEMENT_TYPES.map((type) => ({ id: type, name: type })),
              ]}
              searchPlaceholder="Search applies_to agreement..."
              fullWidth={true}
              error={Boolean(formErrors.applies_to)}
            />

            {/* Field: number */}
            <TextField
              label="number"
              size="small"
              placeholder="e.g. 1.0 or 0.1"
              value={formData.number}
              onChange={(e) => handleFormChange('number', e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{
                '& .MuiOutlinedInput-root': { borderRadius: '8px', fontSize: '13px' },
              }}
            />
          </Box>

          {/* Row 2: name and key */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            {/* Field: name */}
            <TextField
              label="name *"
              size="small"
              placeholder="e.g. Indemnification"
              value={formData.name}
              onChange={(e) => handleFormChange('name', e.target.value)}
              error={Boolean(formErrors.name)}
              helperText={formErrors.name}
              InputLabelProps={{ shrink: true }}
              sx={{
                '& .MuiOutlinedInput-root': { borderRadius: '8px', fontSize: '13px' },
              }}
            />

            {/* Field: key */}
            <TextField
              label="key *"
              size="small"
              placeholder="e.g. indemnification"
              value={formData.key}
              onChange={(e) => handleFormChange('key', e.target.value)}
              error={Boolean(formErrors.key)}
              helperText={formErrors.key || 'Unique lowercase machine identifier'}
              InputLabelProps={{ shrink: true }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontFamily: 'monospace',
                },
              }}
            />
          </Box>

          {/* Field: definition */}
          <TextField
            label="definition"
            size="small"
            placeholder="Detailed definition and scope criteria for this taxonomy entry..."
            value={formData.definition}
            onChange={(e) => handleFormChange('definition', e.target.value)}
            multiline
            rows={3}
            InputLabelProps={{ shrink: true }}
            sx={{
              '& .MuiOutlinedInput-root': { borderRadius: '8px', fontSize: '13px' },
            }}
          />

          {/* Field: aliases */}
          <TextField
            label="aliases"
            size="small"
            placeholder="Comma-separated alternate terms (e.g. Hold Harmless, Indemnity, Defense)"
            value={formData.aliases}
            onChange={(e) => handleFormChange('aliases', e.target.value)}
            InputLabelProps={{ shrink: true }}
            helperText="Alternate titles and synonym keywords recognized by extraction"
            sx={{
              '& .MuiOutlinedInput-root': { borderRadius: '8px', fontSize: '13px' },
            }}
          />

          {/* Field: excludes */}
          <TextField
            label="excludes"
            size="small"
            placeholder="Items or conditions strictly excluded from this category (e.g. Limitation of liability caps)"
            value={formData.excludes}
            onChange={(e) => handleFormChange('excludes', e.target.value)}
            multiline
            rows={2}
            InputLabelProps={{ shrink: true }}
            helperText="Boundary negative constraints to prevent misclassification"
            sx={{
              '& .MuiOutlinedInput-root': { borderRadius: '8px', fontSize: '13px' },
            }}
          />
        </DialogContent>

        <DialogActions
          sx={{
            p: '16px 24px 20px',
            borderTop: '1px solid #e2e8f0',
            gap: 1.5,
          }}
        >
          <Button
            onClick={handleCloseModal}
            sx={{
              textTransform: 'none',
              fontSize: '13px',
              fontWeight: 600,
              color: '#64748b',
              borderRadius: '8px',
              px: 2,
            }}
          >
            Cancel
          </Button>

          {/* User Request: and a save button */}
          <Button
            variant="contained"
            onClick={handleSaveItem}
            sx={{
              textTransform: 'none',
              fontSize: '13px',
              fontWeight: 600,
              bgcolor: '#1e3a5f',
              color: '#ffffff',
              borderRadius: '8px',
              px: 3,
              py: 0.8,
              boxShadow: '0 2px 6px rgba(30, 58, 95, 0.25)',
              '&:hover': {
                bgcolor: '#152943',
              },
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
