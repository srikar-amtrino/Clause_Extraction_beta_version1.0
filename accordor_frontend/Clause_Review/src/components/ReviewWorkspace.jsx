import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Chip,
  IconButton,
  TextField,
  InputAdornment,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Checkbox,
  LinearProgress,
  Tooltip,
  Menu,
  MenuItem,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import UndoOutlinedIcon from '@mui/icons-material/UndoOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import SearchIcon from '@mui/icons-material/Search';
import ViewColumnOutlinedIcon from '@mui/icons-material/ViewColumnOutlined';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import HistoryIcon from '@mui/icons-material/History';
import NoteAltOutlinedIcon from '@mui/icons-material/NoteAltOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { documentService } from '../services/documentService';
import { useAuth } from '../context/AuthContext';

export default function ReviewWorkspace({
  document: doc,
  onBackToDocuments,
  showToast,
  isSidebarCollapsed = false,
  onToggleSidebar,
}) {
  const { currentUser } = useAuth();
  const currentUserName = currentUser?.username || currentUser?.name || (currentUser?.email ? currentUser.email.split('@')[0] : 'Reviewer');

  const [activeTab, setActiveTab] = useState('review');
  const [activeFilter, setActiveFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRows, setSelectedRows] = useState([]);
  const [templateTypeMenuAnchor, setTemplateTypeMenuAnchor] = useState(null);
  const [extractedClauses, setExtractedClauses] = useState([]);
  const [classificationSummary, setClassificationSummary] = useState(null);
  const [documentMeta, setDocumentMeta] = useState(null);
  const [isLoadingClauses, setIsLoadingClauses] = useState(false);

  // Dropdown anchors for row-level edits (Images 2, 3)
  const [labelAnchor, setLabelAnchor] = useState(null); // { el, rowId, current }
  const [typeAnchor, setTypeAnchor] = useState(null); // { el, rowId, current }

  // Canonical Types taxonomy (matching Image 2)
  const CANONICAL_TYPES = [
    "Definitions & Interpretation",
"Purpose",
"Scope of Services",
"Statements of Work & Work Orders",
"Customer Obligations",
"Service Provider Obligations",
"Term & Termination",
"Deliverables & Acceptance",
"Service Levels",
"Support & Maintenance",
"Change Control",
"Fees & Payment",
"Confidentiality",
"Data Protection & Privacy",
"Intellectual Property",
"Representations & Warranties",
"Indemnification",
"Limitation of Liability",
"Insurance",
"Compliance",
"Audit & Records",
"Subcontractors",
"Assignment",
"Force Majeure",
"Governing Law & Dispute Resolution",
"Notices",
"Independent Contractor",
"General Provisions",
"Agreement Identification",
"Party Identification",
"Preamble",
"Recitals",
"Table of Contents",
"Signature Block",
"Schedule & Exhibit Identification",
"Page Furniture",
"Notes & References",
"Other Non-Clause Content",
  ];

  const SUB_TYPES_BY_CATEGORY = {
    'Interpretation': ['Construction', 'Order of Precedence', 'General Interpretation', 'Headings'],
    'Definitions': ['Defined Terms', 'Interpretation of Terms'],
    'Parties': ['Entity Name', 'Registered Address', 'Company Number'],
    'Recitals': ['Background', 'Context'],
    'Confidentiality': ['Obligation of Secrecy', 'Permitted Disclosures', 'Return or Destruction', 'Exceptions'],
    'Data Protection': ['Controller Responsibilities', 'Processor Obligations', 'Incident Management', 'Data Subject Rights', 'Breach Notification', 'Mitigation and Cooperation', 'Termination', 'Permitted Uses of PHI', 'Disclosure Restrictions', 'PHI Safeguards'],
    'General Provisions': ['Entire Agreement', 'Severability', 'Waiver', 'Amendments', 'Counterparts', 'No Third Party Beneficiaries', 'Independent Contractor', 'Statistical Information', 'Governing Law and Jurisdiction', 'Compliance with Laws', 'Dispute Resolution'],
    'Information Security & Data Management': ['Personnel Safeguards', 'Incident Management', 'Certifications', 'PHI Safeguards', 'Audit & Inspection', 'Access Controls'],
    'Subcontracting & Sub-processors': ['Subcontractors', 'Sub-processor Authorization', 'Liability for Subcontractors'],
    'Governing Law': ['Governing Law and Jurisdiction', 'Venue', 'Arbitration'],
    'Liability': ['Limitation of Liability', 'Cap on Damages', 'Exclusion of Consequential Damages'],
    'Term & Termination': ['Term', 'Termination for Cause', 'Termination for Convenience', 'Effect of Termination'],
    'Warranties': ['Mutual Warranties', 'Service Warranties', 'Disclaimer'],
    'Services & Scope': ['Service Description', 'SLA', 'Change Management'],
    'Fees & Payment': ['Payment Terms', 'Invoicing', 'Taxes', 'Late Fees'],
    'Intellectual Property': ['Ownership', 'License Grant', 'IP Indemnity', 'Restrictions'],
    'Signature Block': ['Signatures', 'Accepted and Agreed', 'Signature', 'Authorized Signatory', 'Date of Signing'],
  };

  // Collect all unique canonical types dynamically from the classification items
  const availableCanonicalTypes = React.useMemo(() => {
    const set = new Set(CANONICAL_TYPES);
    extractedClauses.forEach((r) => {
      if (r.type_name && r.type_name !== 'Unassigned') set.add(r.type_name);
    });
    return Array.from(set);
  }, [extractedClauses]);

  const getSubTypesForType = (typeName) => {
    const list = new Set(['null']);
    const known = SUB_TYPES_BY_CATEGORY[typeName] || [];
    known.forEach((s) => list.add(s));
    extractedClauses.forEach((r) => {
      if ((r.type_name === typeName || r.canonicalType === typeName) && r.sub_type && r.sub_type !== 'null') {
        list.add(r.sub_type);
      }
    });
    return Array.from(list);
  };

  const handleUpdateRow = (rowId, updates) => {
    setExtractedClauses((prev) =>
      prev.map((row) => {
        if (row.id === rowId || row.paraId === rowId || row.classification_id === rowId) {
          const next = { ...row, ...updates };
          if (updates.label === 'Non-clause') {
            next.sub_type = null;
            next.subType = null;
          }
          return next;
        }
        return row;
      })
    );
  };

  // Load real classification data exclusively from http://localhost:8000/api/documents/{documentId}/classification/
  useEffect(() => {
    if (!doc) return;
    const docId = doc.documentId || doc.id;
    if (!docId) return;

    let isMounted = true;
    const loadClauses = async () => {
      setIsLoadingClauses(true);
      try {
        let classRes = await documentService.classification(docId).catch((err) => {
          console.warn('Loading classification from API failed:', err);
          return null;
        });

        // If this document ID returned 0 items, check if another document in the pipeline with the same name has classification
        const rawDocName = classRes?.document?.name || classRes?.document?.title || (doc.name !== 'Loading Document...' ? doc.name : '') || doc.fileName || '';
        const docNameKey = rawDocName.trim().toLowerCase();
        if ((!classRes || !classRes.items || classRes.items.length === 0) && docNameKey) {
          const docList = await documentService.list({ limit: 100 }).catch(() => null);
          const altDoc = docList?.documents?.find(
            (d) => (d.document_id !== docId) &&
                   ((d.name || d.title || '').trim().toLowerCase() === docNameKey) &&
                   d.stages?.classification
          );
          if (altDoc) {
            const altRes = await documentService.classification(altDoc.document_id).catch(() => null);
            if (altRes && altRes.items && altRes.items.length > 0) {
              classRes = altRes;
            }
          }
        }

        if (classRes && Array.isArray(classRes.items) && classRes.items.length > 0) {
          const rows = classRes.items.map((item, i) => {
            const clauseId = item.clause_id || (item.number ? `c${item.number}` : `c${i + 1}`);
            const breadcrumb = item.breadcrumb || item.heading_trail || item.heading || (item.number ? `Clause ${item.number}` : `Clause ${i + 1}`);
            const reviewObj = item.review || null;
            return {
              id: item.classification_id || item.id || `clause-${i}`,
              classification_id: item.classification_id,
              clause_id: clauseId,
              paraId: clauseId,
              number: item.number,
              paragraph_ids: item.paragraph_ids || [],
              heading_trail: breadcrumb,
              breadcrumb: breadcrumb,
              text: item.text || item.chunk_text || '',
              label: item.label || 'Clause',
              type: item.type || 'unassigned',
              type_name: item.type_name || item.type || 'Unassigned',
              canonicalType: item.type_name || item.type || 'Unassigned',
              sub_type: item.sub_type || null,
              subType: item.sub_type || null,
              preview: item.preview || doc.webViewLink || classRes.document?.drive_web_link || '',
              confidence: item.confidence,
              needs_review: Boolean(item.needs_review),
              needsReview: Boolean(item.needs_review),
              review_reasons: item.review_reasons || [],
              deviated: Boolean(item.deviated),
              outcome: item.outcome,
              expected_types: item.expected_types || [],
              review: reviewObj,
              decision: reviewObj?.decision || (item.needs_review ? 'needs_review' : 'accepted'),
              note: reviewObj?.note || '',
            };
          });

          if (isMounted) {
            setExtractedClauses(rows);
            if (classRes.summary) {
              setClassificationSummary(classRes.summary);
            }
            if (classRes.document) {
              setDocumentMeta(classRes.document);
            }
          }
        } else {
          if (isMounted) {
            setExtractedClauses([]);
          }
        }
      } catch (err) {
        if (isMounted) {
          console.warn('Loading classification from API error:', err);
          setExtractedClauses([]);
        }
      } finally {
        if (isMounted) {
          setIsLoadingClauses(false);
        }
      }
    };

    loadClauses();
    return () => {
      isMounted = false;
    };
  }, [doc]);

  if (!doc) {
    return (
      <Box sx={{ p: 4, textAlign: 'center', bgcolor: '#ffffff', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <DescriptionOutlinedIcon sx={{ fontSize: 48, color: '#94a3b8', mb: 1.5 }} />
        <Typography variant="h6" sx={{ color: '#1b1f24', fontWeight: 600 }}>No document selected</Typography>
        <Typography variant="body2" sx={{ color: '#64748b', mt: 0.5, mb: 2.5 }}>
          Select a document from your Google Drive files to view its review workspace template.
        </Typography>
        <Button onClick={onBackToDocuments} variant="contained" sx={{ bgcolor: '#1e3a5f', textTransform: 'none' }}>
          Back to Documents
        </Button>
      </Box>
    );
  }

  const docName = documentMeta?.name || doc.name || 'Document';
  const docTitle = documentMeta?.title || doc.title || docName;
  const webViewLink = documentMeta?.drive_web_link || doc.webViewLink;

  // Document-level note state for the entire file
  const docId = doc?.documentId || doc?.id || '';
  const [documentNote, setDocumentNote] = useState(() => {
    if (!docId) return '';
    try {
      return localStorage.getItem(`clausewright_doc_note_${docId}`) || doc?.documentNote || doc?.note || '';
    } catch {
      return doc?.documentNote || doc?.note || '';
    }
  });
  const [noteSavedAt, setNoteSavedAt] = useState(null);

  useEffect(() => {
    if (!docId) return;
    try {
      const saved = localStorage.getItem(`clausewright_doc_note_${docId}`);
      if (saved !== null) {
        setDocumentNote(saved);
      } else {
        setDocumentNote(doc?.documentNote || doc?.note || '');
      }
    } catch {
      setDocumentNote(doc?.documentNote || doc?.note || '');
    }
    setNoteSavedAt(null);
  }, [docId, doc]);

  const handleSaveDocumentNote = () => {
    if (docId) {
      try {
        localStorage.setItem(`clausewright_doc_note_${docId}`, documentNote);
      } catch (err) {
        console.warn('Saving note error:', err);
      }
    }
    setNoteSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    showToast?.(`Document note saved for ${docName}`);
  };

  const totalChunks = classificationSummary?.micro_chunks ?? extractedClauses.length;
  const toReviewCount = classificationSummary?.needs_review ?? extractedClauses.filter((r) => r.needs_review).length;
  const reviewedCount = classificationSummary?.review?.reviewed ?? 0;
  const acceptedCount = classificationSummary?.review?.accepted ?? 0;
  const needsFixCount = extractedClauses.filter((r) => r.deviated || r.outcome === 'failed' || (r.review_reasons && r.review_reasons.length > 0)).length;
  const editedCount = classificationSummary?.review?.corrected ?? extractedClauses.filter((r) => r.review).length;
  const lowConfCount = extractedClauses.filter((r) => (r.confidence !== null && r.confidence !== undefined && r.confidence < 0.85) || (r.review_reasons && r.review_reasons.includes('low_confidence'))).length;

  const progressPercent = totalChunks > 0 ? Math.round((reviewedCount / totalChunks) * 100) : 0;

  // Filtered rows for the table based on activeFilter, typeFilter, and searchQuery
  const filteredClauses = React.useMemo(() => {
    return extractedClauses.filter((row) => {
      // 1. Tab filter
      if (activeFilter === 'to-review' && !row.needs_review) return false;
      if (activeFilter === 'needs-fix' && !(row.deviated || row.outcome === 'failed' || (row.review_reasons && row.review_reasons.length > 0))) return false;
      if (activeFilter === 'edited' && !row.review) return false;
      if (activeFilter === 'low-conf' && !((row.confidence !== null && row.confidence !== undefined && row.confidence < 0.85) || (row.review_reasons && row.review_reasons.includes('low_confidence')))) return false;

      // 2. Type menu filter
      if (typeFilter === 'clauses' && row.label !== 'Clause') return false;
      if (typeFilter === 'non-clauses' && row.label !== 'Non-clause') return false;

      // 3. Search query
      if (searchQuery && searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const textMatch = (row.text || '').toLowerCase().includes(q);
        const breadcrumbMatch = (row.breadcrumb || '').toLowerCase().includes(q);
        const idMatch = (row.clause_id || row.paraId || '').toLowerCase().includes(q);
        const typeMatch = (row.type_name || row.canonicalType || '').toLowerCase().includes(q);
        const subTypeMatch = (row.sub_type || '').toLowerCase().includes(q);
        if (!textMatch && !breadcrumbMatch && !idMatch && !typeMatch && !subTypeMatch) return false;
      }
      return true;
    });
  }, [extractedClauses, activeFilter, typeFilter, searchQuery]);

  // Status badge styling helper
  const getStatusBadgeStyle = (status) => {
    switch (status) {
      case 'Draft':
        return { bgcolor: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' };
      case 'Needs review':
        return { bgcolor: '#f3f4f6', color: '#4b5563', border: '1px solid #e5e7eb' };
      case 'In review':
        return { bgcolor: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' };
      case 'Updated to vector DB':
        return { bgcolor: '#e0e7ff', color: '#3730a3', border: '1px solid #c7d2fe' };
      case 'Reviewed':
        return { bgcolor: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' };
      case 'Saved':
        return { bgcolor: '#f3e8ff', color: '#6b21a8', border: '1px solid #e9d5ff' };
      default:
        return { bgcolor: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' };
    }
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedRows(filteredClauses.map((_, i) => i));
    } else {
      setSelectedRows([]);
    }
  };

  const handleToggleRow = (index) => {
    if (selectedRows.includes(index)) {
      setSelectedRows(selectedRows.filter((i) => i !== index));
    } else {
      setSelectedRows([...selectedRows, index]);
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        bgcolor: '#ffffff',
        overflow: 'hidden',
      }}
    >
      {/* 1. TOP BREADCRUMB & HEADER SECTION */}
      <Box
        sx={{
          px: { xs: 2, sm: 3 },
          pt: 1.75,
          pb: 1.5,
          borderBottom: '1px solid #e3e3de',
          bgcolor: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25,
        }}
      >
        {/* Breadcrumb row */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '12px', color: '#7b838c' }}>
          {isSidebarCollapsed && onToggleSidebar && (
            <Tooltip title="Expand sidebar" arrow placement="bottom">
              <IconButton
                size="small"
                onClick={onToggleSidebar}
                sx={{
                  p: 0.4,
                  mr: 0.5,
                  color: '#64748b',
                  borderRadius: 1,
                  '&:hover': { bgcolor: '#f1f5f9', color: '#1e3a5f' },
                }}
              >
                <ChevronRightIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          )}
          <Box
            component="button"
            onClick={onBackToDocuments}
            sx={{
              background: 'none',
              border: 'none',
              p: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              color: '#1e3a5f',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            <ArrowBackIcon sx={{ fontSize: 14 }} />
            Documents
          </Box>
          <span>›</span>
          <span>{doc.folder || 'Google Drive'}</span>
          <span>›</span>
          <Typography sx={{ fontSize: '12px', color: '#1b1f24', fontWeight: 500 }}>
            {docName}
          </Typography>
        </Box>

        {/* Title & Actions Row */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 2,
          }}
        >
          {/* Document Title, Status, Progress */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Typography
                variant="h6"
                sx={{
                  fontWeight: 700,
                  fontSize: '17px',
                  color: '#1b1f24',
                  letterSpacing: '-0.01em',
                }}
              >
                {docName}
              </Typography>
              <IconButton size="small" sx={{ p: 0.25, color: '#7b838c' }}>
                <KeyboardArrowDownIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>

            {/* Status chip */}
            <Chip
              label={`• ${doc.status || 'Extracted'}`}
              size="small"
              sx={{
                height: 22,
                fontSize: '11.5px',
                fontWeight: 600,
                ...getStatusBadgeStyle(doc.status),
              }}
            />
          </Box>

          {/* Right Top Actions */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: '#7b838c', fontSize: '12px' }}>
              <EditOutlinedIcon sx={{ fontSize: 14 }} />
              <span>Saved {doc.lastSaved || 'Today'}</span>
            </Box>

            <Tooltip title="Undo changes">
              <IconButton
                size="small"
                onClick={() => showToast?.('Undo action triggered')}
                sx={{
                  border: '1px solid #e3e3de',
                  borderRadius: 1.25,
                  p: 0.6,
                  color: '#4a5159',
                  '&:hover': { bgcolor: '#f5f5f2' },
                }}
              >
                <UndoOutlinedIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>

            <Button
              variant="outlined"
              size="small"
              startIcon={<SaveOutlinedIcon sx={{ fontSize: 15 }} />}
              onClick={() => showToast?.(`Saved changes for ${docName}`)}
              sx={{
                height: 32,
                fontSize: '12px',
                fontWeight: 600,
                textTransform: 'none',
                borderColor: '#cfcfc8',
                color: '#1b1f24',
                bgcolor: '#ffffff',
                borderRadius: 1.25,
                '&:hover': { bgcolor: '#f5f5f2', borderColor: '#1e3a5f' },
              }}
            >
              Save
            </Button>

            <Button
              variant="contained"
              size="small"
              startIcon={<CloudUploadOutlinedIcon sx={{ fontSize: 16 }} />}
              onClick={() => showToast?.(`Updating "${docName}" to vector database...`)}
              sx={{
                height: 32,
                fontSize: '12px',
                fontWeight: 600,
                textTransform: 'none',
                bgcolor: '#1e3a5f',
                color: '#ffffff',
                borderRadius: 1.25,
                px: 1.75,
                boxShadow: 'none',
                '&:hover': { bgcolor: '#152943', boxShadow: 'none' },
              }}
            >
              Update to vector DB
            </Button>
          </Box>
        </Box>

        {/* Subheader info & counts row */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 1.5,
            pt: 0.5,
            fontSize: '12px',
            color: '#7b838c',
          }}
        >
          {/* Real file details */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <span>pages: {doc.pages ?? 1} · clauses: {doc.clauses ?? totalChunks} · paragraphs: {doc.paragraphs ?? totalChunks} · {doc.size || 'Document'}</span>
            <span>|</span>
            <span>Extraction: <strong style={{ color: doc.extractionStatus === 'rejected' ? '#b91c1c' : '#1b1f24', textTransform: 'capitalize' }}>{doc.extractionStatus ? doc.extractionStatus.replace(/_/g, ' ') : 'Extracted'}</strong></span>
            <span>|</span>
            <span>Needs review: <strong style={{ color: toReviewCount > 0 ? '#c2410c' : '#1b1f24' }}>{toReviewCount}</strong></span>
            <span>|</span>
            <span>Reviewer <strong style={{ color: '#1b1f24' }}>{doc.reviewer || currentUserName}</strong></span>
          </Box>

          {/* Status color count pills */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, fontSize: '11.5px', color: '#374151' }}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#16a34a' }} />
              <span>Reviewed {reviewedCount}</span>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, fontSize: '11.5px', color: '#374151' }}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#7c3aed' }} />
              <span>Edited {editedCount}</span>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, fontSize: '11.5px', color: '#374151' }}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#dc2626' }} />
              <span>Needs a fix {needsFixCount}</span>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, fontSize: '11.5px', color: '#374151' }}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#9ca3af' }} />
              <span>Untouched {Math.max(0, totalChunks - reviewedCount)}</span>
            </Box>
          </Box>
        </Box>
      </Box>

      {/* 2. TABS & WORKSPACE TOOLBAR */}
      <Box
        sx={{
          px: { xs: 2, sm: 3 },
          pt: 1,
          pb: 1,
          borderBottom: '1px solid #e3e3de',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1.5,
          bgcolor: '#ffffff',
        }}
      >
        {/* Navigation Tabs */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box
            onClick={() => setActiveTab('review')}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              pb: 0.75,
              pt: 0.25,
              borderBottom: activeTab === 'review' ? '2px solid #1e3a5f' : '2px solid transparent',
              color: activeTab === 'review' ? '#1e3a5f' : '#7b838c',
              fontWeight: activeTab === 'review' ? 600 : 500,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            <CheckCircleOutlinedIcon sx={{ fontSize: 16 }} />
            <span>Review</span>
          </Box>

          <Box
            onClick={() => setActiveTab('history')}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              pb: 0.75,
              pt: 0.25,
              borderBottom: activeTab === 'history' ? '2px solid #1e3a5f' : '2px solid transparent',
              color: activeTab === 'history' ? '#1e3a5f' : '#7b838c',
              fontWeight: activeTab === 'history' ? 600 : 500,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            <HistoryIcon sx={{ fontSize: 16 }} />
            <span>History</span>
            <Chip label="0" size="small" sx={{ height: 18, fontSize: '10.5px', bgcolor: '#f3f4f6', color: '#4b5563' }} />
          </Box>

          <Box
            onClick={() => setActiveTab('note')}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              pb: 0.75,
              pt: 0.25,
              borderBottom: activeTab === 'note' ? '2px solid #1e3a5f' : '2px solid transparent',
              color: activeTab === 'note' ? '#1e3a5f' : '#7b838c',
              fontWeight: activeTab === 'note' ? 600 : 500,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            <NoteAltOutlinedIcon sx={{ fontSize: 16 }} />
            <span>Document note</span>
            {documentNote.trim() && (
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#0284c7' }} />
            )}
          </Box>
        </Box>
      </Box>

      {/* Review Tab Content */}
      {activeTab === 'review' && (
        <>
          {/* 3. SEARCH & FILTER TOOLBAR */}
      <Box
        sx={{
          px: { xs: 2, sm: 3 },
          py: 1.25,
          bgcolor: '#fafaf8',
          borderBottom: '1px solid #e3e3de',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1.5,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
          {/* Find in document */}
          <TextField
            size="small"
            placeholder="Find in this document..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            sx={{
              width: { xs: 180, sm: 220 },
              '& .MuiOutlinedInput-root': {
                height: 32,
                fontSize: '12px',
                bgcolor: '#ffffff',
                borderRadius: 1.5,
                '& fieldset': { borderColor: '#cfcfc8' },
                '&:hover fieldset': { borderColor: '#b9cde0' },
                '&.Mui-focused fieldset': { borderColor: '#1e3a5f' },
              },
            }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: '#7b838c', fontSize: 16 }} />
                  </InputAdornment>
                ),
              },
            }}
          />

          {/* Filter Pills */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            {[
              { id: 'all', label: `All ${extractedClauses.length}` },
              { id: 'to-review', label: `To review ${toReviewCount > 0 ? `(${toReviewCount})` : ''}` },
              { id: 'needs-fix', label: `Needs a fix ${needsFixCount > 0 ? `(${needsFixCount})` : ''}` },
              { id: 'edited', label: `Edited ${editedCount > 0 ? `(${editedCount})` : ''}` },
              { id: 'low-conf', label: `Low confidence ${lowConfCount > 0 ? `(${lowConfCount})` : ''}` },
            ].map((f) => (
              <Button
                key={f.id}
                size="small"
                onClick={() => setActiveFilter(f.id)}
                sx={{
                  height: 28,
                  fontSize: '11.5px',
                  fontWeight: activeFilter === f.id ? 600 : 500,
                  textTransform: 'none',
                  px: 1.25,
                  borderRadius: 1.5,
                  bgcolor: activeFilter === f.id ? '#1e3a5f' : '#ffffff',
                  color: activeFilter === f.id ? '#ffffff' : '#4a5159',
                  border: '1px solid',
                  borderColor: activeFilter === f.id ? '#1e3a5f' : '#cfcfc8',
                  '&:hover': {
                    bgcolor: activeFilter === f.id ? '#152943' : '#f5f5f2',
                  },
                }}
              >
                {f.label}
              </Button>
            ))}

            {/* All types dropdown button */}
            <Button
              size="small"
              endIcon={<KeyboardArrowDownIcon sx={{ fontSize: 14 }} />}
              onClick={(e) => setTemplateTypeMenuAnchor(e.currentTarget)}
              sx={{
                height: 28,
                fontSize: '11.5px',
                fontWeight: 500,
                textTransform: 'none',
                px: 1.25,
                bgcolor: '#ffffff',
                color: '#4a5159',
                border: '1px solid #cfcfc8',
                borderRadius: 1.5,
                '&:hover': { bgcolor: '#f5f5f2' },
              }}
            >
              {typeFilter === 'clauses' ? 'Clauses only' : typeFilter === 'non-clauses' ? 'Non-clause' : 'All types'}
            </Button>
            <Menu
              anchorEl={templateTypeMenuAnchor}
              open={Boolean(templateTypeMenuAnchor)}
              onClose={() => setTemplateTypeMenuAnchor(null)}
              slotProps={{ paper: { sx: { fontSize: '12px', minWidth: 140 } } }}
            >
              <MenuItem onClick={() => { setTypeFilter('all'); setTemplateTypeMenuAnchor(null); }}>All types</MenuItem>
              <MenuItem onClick={() => { setTypeFilter('clauses'); setTemplateTypeMenuAnchor(null); }}>Clauses only</MenuItem>
              <MenuItem onClick={() => { setTypeFilter('non-clauses'); setTemplateTypeMenuAnchor(null); }}>Non-clause</MenuItem>
            </Menu>
          </Box>
        </Box>

        {/* Right Buttons: Columns & Source document */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          

          <Button
            size="small"
            startIcon={<ArticleOutlinedIcon sx={{ fontSize: 16 }} />}
            onClick={() => {
              if (doc.webViewLink) {
                window.open(doc.webViewLink, '_blank');
              } else {
                showToast?.(`Opening source document view for ${doc.fileName}`);
              }
            }}
            sx={{
              height: 28,
              fontSize: '11.5px',
              fontWeight: 500,
              textTransform: 'none',
              bgcolor: '#ffffff',
              color: '#4a5159',
              border: '1px solid #cfcfc8',
              borderRadius: 1.5,
              '&:hover': { bgcolor: '#f5f5f2' },
            }}
          >
            Source document
          </Button>
        </Box>
      </Box>

      {/* 4. MAIN CLAUSE REVIEW TEMPLATE TABLE */}
      <Box sx={{ flex: 1, overflowY: 'auto', bgcolor: '#ffffff' }}>
        <TableContainer sx={{ width: '100%', height: '100%' }}>
          <Table stickyHeader size="small" sx={{ width: '100%', minWidth: 900 }}>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" sx={{ bgcolor: '#fafaf8', py: 1, borderBottom: '1px solid #e3e3de', width: 44, minWidth: 44 }}>
                  <Checkbox
                    size="small"
                    indeterminate={selectedRows.length > 0 && selectedRows.length < filteredClauses.length}
                    checked={filteredClauses.length > 0 && selectedRows.length === filteredClauses.length}
                    onChange={handleSelectAll}
                    disabled={filteredClauses.length === 0}
                    sx={{ p: 0.5 }}
                  />
                </TableCell>
                <TableCell sx={{ bgcolor: '#fafaf8', py: 1, fontSize: '11.5px', fontWeight: 600, color: '#7b838c', borderBottom: '1px solid #e3e3de', width: 85, minWidth: 85 }}>
                  Clause ID
                </TableCell>
                <TableCell sx={{ bgcolor: '#fafaf8', py: 1, fontSize: '11.5px', fontWeight: 600, color: '#7b838c', borderBottom: '1px solid #e3e3de', width: 140, minWidth: 140 }}>
                  Breadcrumb
                </TableCell>
                <TableCell sx={{ bgcolor: '#fafaf8', py: 1, fontSize: '11.5px', fontWeight: 600, color: '#7b838c', borderBottom: '1px solid #e3e3de', minWidth: 400 }}>
                  Text Information
                </TableCell>
                <TableCell sx={{ bgcolor: '#fafaf8', py: 1, fontSize: '11.5px', fontWeight: 600, color: '#7b838c', borderBottom: '1px solid #e3e3de', width: 110, minWidth: 110 }}>
                  Label
                </TableCell>
                <TableCell sx={{ bgcolor: '#fafaf8', py: 1, fontSize: '11.5px', fontWeight: 600, color: '#7b838c', borderBottom: '1px solid #e3e3de', width: 170, minWidth: 170 }}>
                  Canonical type
                </TableCell>
                <TableCell sx={{ bgcolor: '#fafaf8', py: 1, fontSize: '11.5px', fontWeight: 600, color: '#7b838c', borderBottom: '1px solid #e3e3de', width: 140, minWidth: 140 }}>
                  Sub-type
                </TableCell>
                <TableCell align="center" sx={{ bgcolor: '#fafaf8', py: 1, fontSize: '11.5px', fontWeight: 600, color: '#7b838c', borderBottom: '1px solid #e3e3de', width: 60, minWidth: 60 }}>
                  Preview
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoadingClauses ? (
                <TableRow>
                  <TableCell colSpan={8} sx={{ py: 6, textAlign: 'center' }}>
                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 2,
                        maxWidth: 360,
                        mx: 'auto',
                      }}
                    >
                      <LinearProgress sx={{ width: '100%', height: 4, borderRadius: 2 }} />
                      <Typography sx={{ fontSize: '13px', color: '#64748b' }}>
                        Loading classification from backend pipeline...
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              ) : filteredClauses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} sx={{ py: 6, textAlign: 'center' }}>
                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 1.5,
                        maxWidth: 440,
                        mx: 'auto',
                      }}
                    >
                      <Box
                        sx={{
                          width: 48,
                          height: 48,
                          borderRadius: '50%',
                          bgcolor: '#f1f5f9',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#64748b',
                        }}
                      >
                        <DescriptionOutlinedIcon sx={{ fontSize: 24 }} />
                      </Box>
                      <Typography sx={{ fontSize: '14px', fontWeight: 600, color: '#1e293b' }}>
                        {extractedClauses.length === 0 ? `No clauses found for ${docName}` : 'No matching clauses found'}
                      </Typography>
                      <Typography sx={{ fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                        {extractedClauses.length === 0
                          ? `No classification data returned from /api/documents/${doc.documentId || doc.id}/classification/.`
                          : 'Try changing your filter pills or search keyword.'}
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              ) : (
                filteredClauses.map((row, idx) => {
                  const isSelected = selectedRows.includes(idx);
                  return (
                    <TableRow
                      key={row.paraId || row.id || idx}
                      hover
                      selected={isSelected}
                      sx={{
                        cursor: 'pointer',
                        borderLeft: idx === 0 ? '3px solid #0284c7' : '3px solid transparent',
                        bgcolor: idx === 0 ? '#f8fafc' : isSelected ? '#f1f5f9' : '#ffffff',
                        '&:hover': { bgcolor: '#f8fafc' },
                      }}
                    >
                      <TableCell padding="checkbox" sx={{ py: 1 }}>
                        <Checkbox
                          size="small"
                          checked={isSelected}
                          onChange={() => handleToggleRow(idx)}
                          sx={{ p: 0.5 }}
                        />
                      </TableCell>

                      {/* Clause ID / Para ID with bullet circle */}
                      <TableCell sx={{ py: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Tooltip title={row.needs_review ? 'Needs review' : 'High confidence / Verified'}>
                            <Box
                              sx={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                bgcolor: row.needs_review ? '#f59e0b' : '#22c55e',
                                flexShrink: 0,
                              }}
                            />
                          </Tooltip>
                          <Typography sx={{ fontSize: '12px', fontWeight: 600, color: '#1e293b' }}>
                            {row.clause_id || row.paraId}
                          </Typography>
                        </Box>
                      </TableCell>

                      {/* Breadcrumb (heading_trail) */}
                      <TableCell sx={{ py: 1, verticalAlign: 'top' }}>
                        <Typography sx={{ fontSize: '12px', fontWeight: 600, color: '#1e293b', lineHeight: 1.3 }}>
                          {row.breadcrumb?.includes(' > ')
                            ? row.breadcrumb.split(' > ')[0]
                            : (row.heading_trail || 'General')}
                        </Typography>
                        {row.breadcrumb?.includes(' > ') ? (
                          <Typography sx={{ fontSize: '11px', color: '#64748b', lineHeight: 1.3 }}>
                            {row.breadcrumb.split(' > ').slice(1).join(' > ')}
                          </Typography>
                        ) : row.heading_trail && row.heading_trail !== row.breadcrumb ? (
                          <Typography sx={{ fontSize: '11px', color: '#64748b', lineHeight: 1.3 }}>
                            {row.heading_trail}
                          </Typography>
                        ) : null}
                      </TableCell>

                      {/* Text Information (Image 2 style: naturally wide, comfortable reading line) */}
                      <TableCell sx={{ py: 1.25, pr: 3, verticalAlign: 'top' }}>
                        <Typography
                          sx={{
                            fontSize: '12.5px',
                            color: row.text ? '#1e293b' : '#94a3b8',
                            fontStyle: row.text ? 'normal' : 'italic',
                            lineHeight: 1.55,
                            letterSpacing: '0.005em',
                            whiteSpace: 'normal',
                            wordBreak: 'break-word',
                          }}
                        >
                          {row.text || '[Empty clause text]'}
                        </Typography>
                      </TableCell>

                      {/* Label with Dropdown (matching Image 3) */}
                      <TableCell sx={{ py: 1 }}>
                        <Button
                          size="small"
                          onClick={(e) => setLabelAnchor({ el: e.currentTarget, rowId: row.id, current: row.label })}
                          sx={{
                            height: 26,
                            minWidth: 84,
                            fontSize: '11px',
                            fontWeight: 500,
                            textTransform: 'none',
                            px: 1,
                            borderRadius: 1,
                            bgcolor: row.label === 'Clause' ? '#eff6ff' : '#f8fafc',
                            color: row.label === 'Clause' ? '#1d4ed8' : '#64748b',
                            border: labelAnchor?.rowId === row.id
                              ? '1.5px solid #1e3a5f'
                              : row.label === 'Clause'
                              ? '1px solid #bfdbfe'
                              : '1px solid #e2e8f0',
                            boxShadow: labelAnchor?.rowId === row.id ? '0 0 0 1px #1e3a5f' : 'none',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            '&:hover': {
                              bgcolor: row.label === 'Clause' ? '#dbeafe' : '#f1f5f9',
                              borderColor: '#1e3a5f',
                            },
                          }}
                        >
                          {row.label || 'Clause'}
                        </Button>
                      </TableCell>

                      {/* Canonical Type (type_name) with Dropdown (matching Image 2) */}
                      <TableCell sx={{ py: 1 }}>
                        <Box
                          onClick={(e) => setTypeAnchor({ el: e.currentTarget, rowId: row.id, current: row.type_name || row.canonicalType })}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            px: 1,
                            py: 0.4,
                            borderRadius: 1,
                            cursor: 'pointer',
                            border: typeAnchor?.rowId === row.id ? '1.5px solid #1e3a5f' : '1px solid #cbd5e1',
                            bgcolor: '#ffffff',
                            boxShadow: typeAnchor?.rowId === row.id ? '0 0 0 1px #1e3a5f' : 'none',
                            '&:hover': {
                              borderColor: '#1e3a5f',
                            },
                          }}
                        >
                          <Typography
                            sx={{
                              fontSize: '12px',
                              fontWeight: 500,
                              color: (row.type_name || row.canonicalType) === 'Unassigned' ? '#94a3b8' : '#1e293b',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              mr: 0.5,
                            }}
                          >
                            {row.type_name || row.canonicalType || 'Unassigned'}
                          </Typography>
                          <KeyboardArrowDownIcon sx={{ fontSize: 15, color: '#64748b', flexShrink: 0 }} />
                        </Box>
                      </TableCell>

                      {/* Sub-type Text Box (Manual input) */}
                      <TableCell sx={{ py: 1, verticalAlign: 'top' }}>
                        <TextField
                          size="small"
                          placeholder="Sub-type"
                          value={row.sub_type || ''}
                          onChange={(e) =>
                            handleUpdateRow(row.id, {
                              sub_type: e.target.value,
                              subType: e.target.value,
                            })
                          }
                          sx={{
                            width: '100%',
                            minWidth: 110,
                            maxWidth: 150,
                            '& .MuiOutlinedInput-root': {
                              height: 28,
                              fontSize: '12px',
                              bgcolor: '#ffffff',
                              borderRadius: 1,
                              '& fieldset': { borderColor: '#cbd5e1' },
                              '&:hover fieldset': { borderColor: '#94a3b8' },
                              '&.Mui-focused fieldset': { borderColor: '#1e3a5f' },
                            },
                            '& .MuiInputBase-input': {
                              py: 0.5,
                              px: 1,
                              fontSize: '12px',
                              color: '#1e293b',
                            },
                          }}
                        />
                      </TableCell>

                      {/* Preview */}
                      <TableCell align="center" sx={{ py: 1 }}>
                        <Tooltip title={row.preview || webViewLink ? "Open preview" : "Preview"}>
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              const previewUrl = row.preview || webViewLink;
                              if (previewUrl) {
                                window.open(previewUrl, '_blank');
                              } else {
                                showToast?.(`Preview: ${row.clause_id || row.paraId} (${row.heading_trail || row.breadcrumb || 'Clause'})`);
                              }
                            }}
                            sx={{ p: 0.25, color: '#94a3b8', '&:hover': { color: '#0284c7' } }}
                          >
                            <VisibilityOutlinedIcon sx={{ fontSize: 15 }} />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

          {/* 5. FOOTER STATUS BAR WITH SHORTCUTS */}
          <Box
            sx={{
              height: 36,
              minHeight: 36,
              bgcolor: '#fafaf8',
              borderTop: '1px solid #e3e3de',
              px: { xs: 2, sm: 3 },
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '11.5px',
              color: '#64748b',
              userSelect: 'none',
            }}
          >
            {/* Left: row selection info */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <span>{selectedRows.length > 0 ? `${selectedRows.length} row(s) selected` : 'No rows selected'}</span>
              <span>|</span>
              <span style={{ color: '#0f172a', fontWeight: 500 }}>
                {docName}
              </span>
              <span>|</span>
              <span>Showing {filteredClauses.length} of {extractedClauses.length} items</span>
            </Box>

            {/* Right: Keyboard shortcuts */}
            <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 1.75 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box component="span" sx={{ px: 0.6, py: 0.1, bgcolor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 0.75, fontSize: '10px', fontWeight: 600, color: '#334155' }}>
                  J
                </Box>
                <Box component="span" sx={{ px: 0.6, py: 0.1, bgcolor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 0.75, fontSize: '10px', fontWeight: 600, color: '#334155' }}>
                  K
                </Box>
                <span>move</span>
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box component="span" sx={{ px: 0.6, py: 0.1, bgcolor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 0.75, fontSize: '10px', fontWeight: 600, color: '#334155' }}>
                  R
                </Box>
                <span>reviewed</span>
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box component="span" sx={{ px: 0.6, py: 0.1, bgcolor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 0.75, fontSize: '10px', fontWeight: 600, color: '#334155' }}>
                  E
                </Box>
                <span>edit</span>
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box component="span" sx={{ px: 0.6, py: 0.1, bgcolor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 0.75, fontSize: '10px', fontWeight: 600, color: '#334155' }}>
                  S
                </Box>
                <span>source</span>
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box component="span" sx={{ px: 0.6, py: 0.1, bgcolor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 0.75, fontSize: '10px', fontWeight: 600, color: '#334155' }}>
                  Ctrl+S
                </Box>
                <span>save</span>
              </Box>
            </Box>
          </Box>
        </>
      )}

      {/* 6. HISTORY PAGE VIEW */}
      {activeTab === 'history' && (
        <Box sx={{ flex: 1, overflowY: 'auto', p: { xs: 2.5, sm: 4 }, bgcolor: '#fafaf8' }}>
          <Box sx={{ maxWidth: 840, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <Box>
              <Typography sx={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                Document History
              </Typography>
              <Typography sx={{ fontSize: '13px', color: '#64748b', mt: 0.5 }}>
                Audit trail and version history for <strong>{docName}</strong>.
              </Typography>
            </Box>

            <Box
              sx={{
                bgcolor: '#ffffff',
                borderRadius: 2,
                border: '1px solid #e2e8f0',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                p: { xs: 4, sm: 6 },
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                gap: 2,
              }}
            >
              <Box
                sx={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  bgcolor: '#f1f5f9',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#64748b',
                }}
              >
                <HistoryIcon sx={{ fontSize: 30 }} />
              </Box>
              <Box sx={{ maxWidth: 420 }}>
                <Typography sx={{ fontSize: '15px', fontWeight: 600, color: '#0f172a' }}>
                  No history recorded yet
                </Typography>
                <Typography sx={{ fontSize: '13px', color: '#64748b', mt: 0.75, lineHeight: 1.5 }}>
                  No previous versions, audit events, or modification logs have been registered for this document yet. Review activity and updates will be logged here.
                </Typography>
              </Box>
              <Button
                variant="outlined"
                size="small"
                onClick={() => setActiveTab('review')}
                sx={{
                  mt: 1,
                  textTransform: 'none',
                  color: '#1e3a5f',
                  borderColor: '#cbd5e1',
                  fontSize: '12px',
                  fontWeight: 600,
                  '&:hover': { borderColor: '#1e3a5f', bgcolor: '#f8fafc' },
                }}
              >
                Return to Review
              </Button>
            </Box>
          </Box>
        </Box>
      )}

      {/* 7. DOCUMENT NOTE PAGE VIEW */}
      {activeTab === 'note' && (
        <Box sx={{ flex: 1, overflowY: 'auto', p: { xs: 2.5, sm: 4 }, bgcolor: '#fafaf8' }}>
          <Box sx={{ maxWidth: 840, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
              <Box>
                <Typography sx={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                  Document Note
                </Typography>
                <Typography sx={{ fontSize: '13px', color: '#64748b', mt: 0.5 }}>
                  Add notes, observations, or review comments for <strong>{docName}</strong>.
                </Typography>
              </Box>
              {noteSavedAt && (
                <Chip
                  size="small"
                  label={`Saved at ${noteSavedAt}`}
                  sx={{ bgcolor: '#dcfce7', color: '#166534', fontWeight: 600, fontSize: '11px' }}
                />
              )}
            </Box>

            <Box
              sx={{
                bgcolor: '#ffffff',
                borderRadius: 2,
                border: '1px solid #e2e8f0',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                p: 2.5,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              <TextField
                multiline
                minRows={10}
                maxRows={24}
                fullWidth
                placeholder="Write your note for this entire document here... (e.g. key clauses needing renegotiation, governing jurisdiction observations, compliance sign-offs)"
                value={documentNote}
                onChange={(e) => {
                  setDocumentNote(e.target.value);
                }}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    fontSize: '13.5px',
                    lineHeight: 1.6,
                    color: '#1e293b',
                    bgcolor: '#fafaf8',
                    borderRadius: 1.5,
                    p: 1.75,
                    '& fieldset': { borderColor: '#e2e8f0' },
                    '&:hover fieldset': { borderColor: '#cbd5e1' },
                    '&.Mui-focused fieldset': { borderColor: '#1e3a5f' },
                  },
                }}
              />

              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5, pt: 0.5 }}>
                <Typography sx={{ fontSize: '12px', color: '#94a3b8' }}>
                  {documentNote.length} characters · {documentNote.trim() ? documentNote.trim().split(/\s+/).length : 0} words
                </Typography>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {documentNote && (
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => {
                        setDocumentNote('');
                        if (docId) {
                          try { localStorage.removeItem(`clausewright_doc_note_${docId}`); } catch (_) {}
                        }
                        showToast?.('Document note cleared');
                      }}
                      sx={{
                        textTransform: 'none',
                        color: '#64748b',
                        borderColor: '#cbd5e1',
                        fontSize: '12.5px',
                        fontWeight: 500,
                        '&:hover': { bgcolor: '#f8fafc', borderColor: '#94a3b8' },
                      }}
                    >
                      Clear
                    </Button>
                  )}
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<SaveOutlinedIcon sx={{ fontSize: 16 }} />}
                    onClick={handleSaveDocumentNote}
                    sx={{
                      textTransform: 'none',
                      bgcolor: '#1e3a5f',
                      color: '#ffffff',
                      fontSize: '12.5px',
                      fontWeight: 600,
                      px: 2,
                      py: 0.8,
                      borderRadius: 1.5,
                      boxShadow: 'none',
                      '&:hover': { bgcolor: '#152943', boxShadow: 'none' },
                    }}
                  >
                    Save Note
                  </Button>
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>
      )}

      {/* FLOATING MENUS FOR ROW-LEVEL DROPDOWNS (Label & Canonical Type) */}
      {/* Label Menu (Image 3) */}
      <Menu
        anchorEl={labelAnchor?.el}
        open={Boolean(labelAnchor)}
        onClose={() => setLabelAnchor(null)}
        slotProps={{
          paper: {
            sx: {
              fontSize: '12px',
              minWidth: 110,
              mt: 0.5,
              borderRadius: 1,
              border: '1px solid #cbd5e1',
              boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
              p: 0,
            },
          },
        }}
      >
        {['Clause', 'Non-clause'].map((lbl) => {
          const isSelected = labelAnchor?.current === lbl;
          return (
            <MenuItem
              key={lbl}
              selected={isSelected}
              onClick={() => {
                handleUpdateRow(labelAnchor.rowId, {
                  label: lbl,
                  sub_type: lbl === 'Non-clause' ? null : undefined,
                });
                setLabelAnchor(null);
              }}
              sx={{
                fontSize: '12px',
                fontWeight: isSelected ? 600 : 400,
                py: 0.7,
                px: 1.5,
                color: isSelected ? '#ffffff !important' : '#1e293b',
                bgcolor: isSelected ? '#1976d2 !important' : 'transparent',
                '&:hover': {
                  bgcolor: isSelected ? '#1565c0 !important' : '#f1f5f9',
                },
              }}
            >
              {lbl}
            </MenuItem>
          );
        })}
      </Menu>

      {/* Canonical Type Menu (Image 2) */}
      <Menu
        anchorEl={typeAnchor?.el}
        open={Boolean(typeAnchor)}
        onClose={() => setTypeAnchor(null)}
        slotProps={{
          paper: {
            sx: {
              maxHeight: 280,
              minWidth: 200,
              mt: 0.5,
              borderRadius: 1,
              border: '1px solid #cbd5e1',
              boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
              p: 0,
            },
          },
        }}
      >
        {availableCanonicalTypes.map((t) => {
          const isSelected = (typeAnchor?.current || '').toLowerCase() === t.toLowerCase();
          return (
            <MenuItem
              key={t}
              selected={isSelected}
              onClick={() => {
                handleUpdateRow(typeAnchor.rowId, {
                  type_name: t,
                  canonicalType: t,
                  type: t.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                });
                setTypeAnchor(null);
              }}
              sx={{
                fontSize: '12px',
                fontWeight: isSelected ? 600 : 400,
                py: 0.7,
                px: 1.5,
                color: isSelected ? '#ffffff !important' : '#1e293b',
                bgcolor: isSelected ? '#1976d2 !important' : 'transparent',
                '&:hover': {
                  bgcolor: isSelected ? '#1565c0 !important' : '#f1f5f9',
                },
              }}
            >
              {t}
            </MenuItem>
          );
        })}
      </Menu>
    </Box>
  );
}
