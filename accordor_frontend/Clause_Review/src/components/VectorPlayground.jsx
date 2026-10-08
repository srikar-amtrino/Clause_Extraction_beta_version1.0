import React, { useState, useCallback, useEffect } from 'react';
import {
  Box, Typography, TextField, Button, CircularProgress, Chip,
  Paper, Divider, Tooltip, Collapse, Alert, Select, MenuItem,
  FormControl, InputLabel, LinearProgress, IconButton,
} from '@mui/material';
import BiotechOutlinedIcon from '@mui/icons-material/BiotechOutlined';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded';
import SpeedOutlinedIcon from '@mui/icons-material/SpeedOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import FilterListOutlinedIcon from '@mui/icons-material/FilterListOutlined';
import BarChartOutlinedIcon from '@mui/icons-material/BarChartOutlined';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import ClearIcon from '@mui/icons-material/Clear';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { getStoredToken } from '../services/authService';
import { AGREEMENT_TYPES, SECTORIAL_OPTIONS } from './FolderMetadataModal';

// ── colour palette matching the app ──────────────────────────────────────────
const NAVY = '#1e3a5f';
const SURFACE = '#fafaf8';
const BORDER = '#e3e3de';
const MUTED = '#7b838c';

const SECTOR_PALETTE = [
  '#0284c7', // Sky Blue
  '#0d9488', // Teal
  '#6366f1', // Indigo
  '#f59e0b', // Amber
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#64748b', // Slate
];

// ── sample clauses ────────────────────────────────────────────────────────────
const SAMPLE_CLAUSES = [
  {
    label: 'Termination for Convenience',
    text: 'Buyer shall have the right in its sole discretion to terminate this Agreement at any time without further obligation to Seller upon giving thirty (30) days prior written notice.',
    agreement: 'Master Services Agreement (MSA)',
    sector: 'Information Technology & Software',
  },
  {
    label: 'Liability & Insurance',
    text: 'The Supplier shall maintain comprehensive general liability insurance with policy limits of not less than $5,000,000 per occurrence and $10,000,000 in aggregate.',
    agreement: 'Statement of Work (SOW)',
    sector: 'Energy, Oil & Utilities',
  },
  {
    label: 'Governing Law',
    text: 'This Agreement and any dispute arising from or related to it shall be governed by and construed in accordance with the laws of the State of California, without regard to conflict of law principles.',
    agreement: 'Vendor / Supplier Agreement',
    sector: 'Telecommunications',
  },
  {
    label: 'Confidentiality & DPA',
    text: 'Each party agrees that all Confidential Information and Personal Data disclosed by one party to the other shall remain the exclusive property of the disclosing party.',
    agreement: 'Master Services Agreement (MSA)',
    sector: 'Real Estate & Infrastructure',
  },
];

// ── helpers ──────────────────────────────────────────────────────────────────
const API_BASE =
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? `http://${window.location.hostname}:8000`
    : (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

async function fetchPlaygroundStats() {
  const token = getStoredToken();
  const resp = await fetch(`${API_BASE}/api/playground/stats/`, {
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!resp.ok) return null;
  return await resp.json();
}

async function callPlayground(text, topN = 10, agreementType = null, sectorialCategory = null) {
  const token = getStoredToken();
  const payload = {
    text,
    top_n: topN,
    agreement_type: agreementType && agreementType !== 'All' ? agreementType : undefined,
    sectorial_category: sectorialCategory && sectorialCategory !== 'All' ? sectorialCategory : undefined,
  };

  const resp = await fetch(`${API_BASE}/api/playground/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.detail || `HTTP ${resp.status}`);
  return data;
}

function confidenceColor(c) {
  if (c >= 0.72) return '#16a34a';
  if (c >= 0.50) return '#d97706';
  return '#dc2626';
}

function confidenceLabel(c) {
  if (c >= 0.72) return 'High';
  if (c >= 0.50) return 'Medium';
  return 'Low';
}

function LatencyBar({ label, value, max }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.75 }}>
      <Typography sx={{ fontSize: '12px', color: MUTED, width: 120, flexShrink: 0 }}>
        {label}
      </Typography>
      <Box sx={{ flex: 1, height: 6, bgcolor: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
        <Box sx={{ height: '100%', width: `${pct}%`, bgcolor: NAVY, borderRadius: 4, transition: 'width 0.4s ease' }} />
      </Box>
      <Typography sx={{ fontSize: '12px', fontWeight: 600, color: '#1b1f24', width: 50, textAlign: 'right' }}>
        {value} ms
      </Typography>
    </Box>
  );
}

// ── Similarity Spectrum Chart ─────────────────────────────────────────────────
function SimilaritySpectrum({ topScore = 0, scores = [], band = 'moderate' }) {
  const topPct = Math.min(100, Math.max(0, topScore * 100));
  const pinColor = band === 'high' ? '#16a34a' : band === 'moderate' ? '#d97706' : '#dc2626';

  return (
    <Box sx={{ width: '100%', mt: 1, mb: 2 }}>
      {/* Spectrum Bar */}
      <Box sx={{ position: 'relative', pt: 3.5, pb: 1 }}>
        {/* Top Match Flag Pointer */}
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: `${topPct}%`,
            transform: 'translateX(-50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            zIndex: 2,
            transition: 'left 0.5s ease',
          }}
        >
          <Box
            sx={{
              bgcolor: pinColor,
              color: '#ffffff',
              fontSize: '11px',
              fontWeight: 800,
              px: 0.75,
              py: 0.2,
              borderRadius: '4px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
              whiteSpace: 'nowrap',
            }}
          >
            Top: {topPct.toFixed(1)}%
          </Box>
          <Box
            sx={{
              width: 0,
              height: 0,
              borderLeft: '4px solid transparent',
              borderRight: '4px solid transparent',
              borderTop: `5px solid ${pinColor}`,
            }}
          />
        </Box>

        {/* Gradient Spectrum Track */}
        <Box
          sx={{
            height: 12,
            borderRadius: 6,
            background: 'linear-gradient(to right, #fecaca 0%, #fef08a 50%, #bbf7d0 75%, #86efac 100%)',
            position: 'relative',
            border: `1px solid ${BORDER}`,
          }}
        >
          {/* Threshold marker: 50% Blindspot floor */}
          <Box
            sx={{
              position: 'absolute',
              left: '50%',
              top: -2,
              bottom: -2,
              width: '2px',
              bgcolor: '#d97706',
              zIndex: 1,
            }}
          />

          {/* Threshold marker: 72% High match */}
          <Box
            sx={{
              position: 'absolute',
              left: '72%',
              top: -2,
              bottom: -2,
              width: '2px',
              bgcolor: '#16a34a',
              zIndex: 1,
            }}
          />

          {/* Plotted match points */}
          {scores.map((s, idx) => {
            const pos = Math.min(100, Math.max(0, s * 100));
            return (
              <Box
                key={idx}
                sx={{
                  position: 'absolute',
                  left: `${pos}%`,
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: idx === 0 ? 14 : 7,
                  height: idx === 0 ? 14 : 7,
                  borderRadius: '50%',
                  bgcolor: idx === 0 ? pinColor : '#475569',
                  border: idx === 0 ? '2px solid #ffffff' : '1px solid #ffffff',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  zIndex: idx === 0 ? 3 : 2,
                }}
              />
            );
          })}
        </Box>
      </Box>

      {/* Axis Scale and Legend */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: MUTED, px: 0.5 }}>
        <span>0% (No overlap)</span>
        <span style={{ color: '#b45309', fontWeight: 600 }}>50% Blindspot Floor</span>
        <span style={{ color: '#15803d', fontWeight: 600 }}>72% High Alignment</span>
        <span>100% (Identical)</span>
      </Box>
    </Box>
  );
}

// ── Match Card ────────────────────────────────────────────────────────────────
function MatchCard({ match }) {
  const [open, setOpen] = useState(false);
  const foundByColor = match.found_by === 'both' ? '#7c3aed' : match.found_by === 'meaning' ? NAVY : '#d97706';

  return (
    <Paper
      variant="outlined"
      sx={{ p: 1.75, borderRadius: '8px', borderColor: BORDER, bgcolor: '#ffffff', mb: 1 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, justifyContent: 'space-between' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap', mb: 0.5 }}>
            <Chip
              label={`#${match.rank}`}
              size="small"
              sx={{ bgcolor: '#f0f4f8', color: NAVY, fontWeight: 700, fontSize: '11px', height: 20 }}
            />
            <Chip
              label={match.found_by}
              size="small"
              sx={{ bgcolor: foundByColor, color: '#fff', fontWeight: 600, fontSize: '11px', height: 20 }}
            />
            <Chip
              label={match.canonical_type || 'Unknown'}
              size="small"
              variant="outlined"
              sx={{ fontSize: '11px', height: 20 }}
            />
            {match.sectorial_category && (
              <Chip
                label={match.sectorial_category}
                size="small"
                sx={{ fontSize: '10.5px', height: 20, bgcolor: '#eff6ff', color: '#1d4ed8', fontWeight: 500 }}
              />
            )}
            {match.agreement_type && (
              <Chip
                label={match.agreement_type}
                size="small"
                sx={{ fontSize: '10.5px', height: 20, bgcolor: '#f8fafc', color: '#475569' }}
              />
            )}
            {match.sub_type && (
              <Chip label={match.sub_type} size="small" variant="outlined" sx={{ fontSize: '11px', height: 20, color: MUTED }} />
            )}
          </Box>
          <Typography
            sx={{
              fontSize: '12.5px',
              color: '#374151',
              lineHeight: 1.55,
              display: '-webkit-box',
              WebkitLineClamp: open ? 'unset' : 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {match.text || <em style={{ color: MUTED }}>No text</em>}
          </Typography>
          {match.shared_keywords?.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.75 }}>
              {match.shared_keywords.map((kw) => (
                <Chip
                  key={kw}
                  label={kw}
                  size="small"
                  sx={{ bgcolor: '#fef9c3', color: '#854d0e', fontSize: '10.5px', height: 18, fontWeight: 500 }}
                />
              ))}
            </Box>
          )}
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5, flexShrink: 0 }}>
          <Typography sx={{ fontSize: '13px', fontWeight: 700, color: confidenceColor(match.similarity_score) }}>
            {(match.similarity_score * 100).toFixed(1)}%
          </Typography>
          <Typography sx={{ fontSize: '10.5px', color: MUTED }}>
            RRF {match.rrf_score.toFixed(4)}
          </Typography>
          <Button size="small" onClick={() => setOpen((p) => !p)} sx={{ minWidth: 0, p: 0.25, color: MUTED }}>
            {open ? <KeyboardArrowUpIcon sx={{ fontSize: 16 }} /> : <KeyboardArrowDownIcon sx={{ fontSize: 16 }} />}
          </Button>
        </Box>
      </Box>
      <Collapse in={open}>
        <Box sx={{ mt: 1, pt: 1, borderTop: `1px solid ${BORDER}` }}>
          <Typography sx={{ fontSize: '11px', color: MUTED }}>
            From document: <strong>{match.document_name || 'Unknown document'}</strong>
          </Typography>
          <Typography sx={{ fontSize: '11px', color: MUTED, mt: 0.25 }}>
            Vector ID: <code>{match.vector_id}</code>
          </Typography>
        </Box>
      </Collapse>
    </Paper>
  );
}

// ── Main VectorPlayground Component ──────────────────────────────────────────
export default function VectorPlayground() {
  const [inputText, setInputText] = useState('');
  const [selectedSector, setSelectedSector] = useState('All');
  const [selectedAgreement, setSelectedAgreement] = useState('All');
  const [showCorpusBreakdown, setShowCorpusBreakdown] = useState(false);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const data = await fetchPlaygroundStats();
      if (data) setStats(data);
    } catch {
      // ignore
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleAnalyze = useCallback(
    async (customText, customSector = null, customAgreement = null) => {
      const text = (typeof customText === 'string' ? customText : inputText).trim();
      if (!text) return;
      if (typeof customText === 'string') setInputText(customText);

      const sector = customSector !== null ? customSector : selectedSector;
      const agreement = customAgreement !== null ? customAgreement : selectedAgreement;

      setLoading(true);
      setError(null);
      setResult(null);
      try {
        const data = await callPlayground(text, 10, agreement, sector);
        setResult(data);
        if (data?.collection_stats?.points_count) {
          setStats((prev) => ({
            ...prev,
            points_count: data.collection_stats.points_count,
          }));
        }
      } catch (err) {
        setError(err.message || 'Something went wrong.');
      } finally {
        setLoading(false);
      }
    },
    [inputText, selectedSector, selectedAgreement]
  );

  const handleQuickSample = (sample) => {
    setInputText(sample.text);
    if (sample.sector) setSelectedSector(sample.sector);
    if (sample.agreement) setSelectedAgreement(sample.agreement);
    handleAnalyze(sample.text, sample.sector || 'All', sample.agreement || 'All');
  };

  const handleClearFilters = () => {
    setSelectedSector('All');
    setSelectedAgreement('All');
  };

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleAnalyze();
  };

  const pred = result?.prediction;
  const perf = result?.performance;
  const matrix = result?.retrieval_matrix;
  const covQual = result?.coverage_and_quality;
  const isBm25Only = result?.retrieval_mode === 'bm25_only';

  const currentPoints = stats?.points_count ?? result?.collection_stats?.points_count ?? 376;
  const currentDocs = stats?.documents_count ?? 8;
  const hasActiveFilters = selectedSector !== 'All' || selectedAgreement !== 'All';

  return (
    <Box
      sx={{
        flex: 1,
        overflowY: 'auto',
        p: { xs: 2, sm: 3, md: 4 },
        display: 'flex',
        flexDirection: 'column',
        gap: 2.5,
        backgroundColor: SURFACE,
      }}
    >
      {/* ── Header ── */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <BiotechOutlinedIcon sx={{ fontSize: 24, color: NAVY }} />
            <Typography variant="h5" sx={{ fontWeight: 700, color: '#1b1f24', letterSpacing: '-0.02em' }}>
              Vector Playground
            </Typography>
            <Chip
              label="Quality & Coverage Diagnostic"
              size="small"
              sx={{ bgcolor: '#eff6ff', color: NAVY, fontWeight: 600, fontSize: '11px' }}
            />
          </Box>
          <Typography variant="body2" sx={{ color: MUTED }}>
            Inspect semantic quality, library coverage depth, and sectorial alignment for any legal clause.
          </Typography>
        </Box>
        {perf && (
          <Tooltip title="Total pipeline latency" arrow>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, bgcolor: '#ffffff', px: 1.5, py: 0.75, borderRadius: '6px', border: `1px solid ${BORDER}` }}>
              <SpeedOutlinedIcon sx={{ fontSize: 16, color: MUTED }} />
              <Typography sx={{ fontSize: '13px', fontWeight: 600, color: '#1b1f24' }}>
                {perf.total_ms} ms
              </Typography>
            </Box>
          </Tooltip>
        )}
      </Box>

      {/* ── Vector DB Population Stats Banner ── */}
      <Paper
        variant="outlined"
        sx={{
          p: 2,
          borderRadius: '10px',
          borderColor: BORDER,
          bgcolor: '#ffffff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}
      >
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75 }}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: '8px',
                bgcolor: '#eff6ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: NAVY,
                flexShrink: 0,
              }}
            >
              <StorageOutlinedIcon sx={{ fontSize: 24 }} />
            </Box>
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography sx={{ fontSize: '15px', fontWeight: 700, color: '#111827' }}>
                  {statsLoading ? (
                    <CircularProgress size={13} sx={{ color: NAVY, mr: 0.75 }} />
                  ) : (
                    currentPoints.toLocaleString()
                  )}
                  {' '}Embeddings Indexed
                </Typography>
                <Chip
                  label="Testing Corpus Phase"
                  size="small"
                  sx={{
                    bgcolor: '#fef3c7',
                    color: '#b45309',
                    fontWeight: 600,
                    fontSize: '11px',
                    height: 20,
                  }}
                />
                <Chip
                  label={`From ${currentDocs} Published Contracts`}
                  size="small"
                  sx={{
                    bgcolor: '#dcfce7',
                    color: '#15803d',
                    fontWeight: 600,
                    fontSize: '11px',
                    height: 20,
                  }}
                />
              </Box>
              <Typography sx={{ fontSize: '12px', color: MUTED, mt: 0.25 }}>
                Collection: <code>{stats?.collection || 'legal_clauses_v1'}</code> &bull; BAAI/bge-m3 1024-d Vectors
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
            {result?.dense_service?.status === 'offline' && (
              <Tooltip title={`Dense model endpoint (${result?.dense_service?.url || 'EC2'}) is currently unreachable. Results are retrieved using BM25 keyword matching.`}>
                <Chip
                  label="Dense: Offline (BM25 Active)"
                  size="small"
                  sx={{ bgcolor: '#fef3c7', color: '#b45309', fontWeight: 600, fontSize: '11px' }}
                />
              </Tooltip>
            )}
            {result?.dense_service?.status === 'online' && (
              <Tooltip title={`Dense embedding model (BAAI/bge-m3) at ${result?.dense_service?.url || 'EC2'} is connected and healthy.`}>
                <Chip
                  label="Dense: Online (Hybrid Active)"
                  size="small"
                  sx={{ bgcolor: '#dcfce7', color: '#15803d', fontWeight: 600, fontSize: '11px' }}
                />
              </Tooltip>
            )}
            <Button
              size="small"
              variant="outlined"
              onClick={() => setShowCorpusBreakdown((prev) => !prev)}
              startIcon={<BarChartOutlinedIcon sx={{ fontSize: 16 }} />}
              sx={{
                textTransform: 'none',
                fontSize: '12px',
                fontWeight: 600,
                color: NAVY,
                borderColor: BORDER,
                py: 0.5,
                px: 1.25,
                borderRadius: '6px',
                '&:hover': { borderColor: NAVY, bgcolor: '#f8fafc' },
              }}
            >
              {showCorpusBreakdown ? 'Hide Corpus Graphs' : 'View Corpus Distribution'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={loadStats}
              disabled={statsLoading}
              startIcon={statsLoading ? <CircularProgress size={12} /> : <RefreshOutlinedIcon sx={{ fontSize: 15 }} />}
              sx={{
                textTransform: 'none',
                fontSize: '12px',
                fontWeight: 600,
                color: NAVY,
                borderColor: BORDER,
                py: 0.5,
                px: 1.25,
                borderRadius: '6px',
                '&:hover': { borderColor: NAVY, bgcolor: '#f8fafc' },
              }}
            >
              Refresh
            </Button>
          </Box>
        </Box>

        {/* ── Graphical Representation of Database Corpus ── */}
        <Collapse in={showCorpusBreakdown}>
          <Box sx={{ mt: 2.5, pt: 2, borderTop: `1px solid ${BORDER}` }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
              {/* Sectorial Distribution Graph */}
              <Box>
                <Typography sx={{ fontSize: '12.5px', fontWeight: 700, color: '#1e293b', mb: 1.25, display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <LayersOutlinedIcon sx={{ fontSize: 16, color: NAVY }} />
                  Database Coverage by Sectorial Category
                </Typography>
                {stats?.sectors_distribution?.map((sec, idx) => (
                  <Box
                    key={sec.name}
                    onClick={() => setSelectedSector(sec.name === selectedSector ? 'All' : sec.name)}
                    sx={{
                      mb: 1.25,
                      cursor: 'pointer',
                      p: 0.75,
                      borderRadius: '6px',
                      bgcolor: selectedSector === sec.name ? '#eff6ff' : 'transparent',
                      '&:hover': { bgcolor: '#f8fafc' },
                      transition: 'background 0.2s ease',
                    }}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', mb: 0.35 }}>
                      <span style={{ fontWeight: selectedSector === sec.name ? 700 : 500, color: '#334155' }}>
                        {sec.name} {selectedSector === sec.name && '(Filter Active)'}
                      </span>
                      <span style={{ fontWeight: 600, color: MUTED }}>
                        {sec.count} ({sec.percentage}%)
                      </span>
                    </Box>
                    <Box sx={{ height: 6, bgcolor: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                      <Box
                        sx={{
                          height: '100%',
                          width: `${sec.percentage}%`,
                          bgcolor: SECTOR_PALETTE[idx % SECTOR_PALETTE.length],
                          borderRadius: 3,
                        }}
                      />
                    </Box>
                  </Box>
                ))}
              </Box>

              {/* Agreement Type Distribution Graph */}
              <Box>
                <Typography sx={{ fontSize: '12.5px', fontWeight: 700, color: '#1e293b', mb: 1.25, display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <BiotechOutlinedIcon sx={{ fontSize: 16, color: NAVY }} />
                  Database Coverage by Agreement Type
                </Typography>
                {stats?.agreements_distribution?.map((agr, idx) => (
                  <Box
                    key={agr.name}
                    onClick={() => setSelectedAgreement(agr.name === selectedAgreement ? 'All' : agr.name)}
                    sx={{
                      mb: 1.25,
                      cursor: 'pointer',
                      p: 0.75,
                      borderRadius: '6px',
                      bgcolor: selectedAgreement === agr.name ? '#eff6ff' : 'transparent',
                      '&:hover': { bgcolor: '#f8fafc' },
                      transition: 'background 0.2s ease',
                    }}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', mb: 0.35 }}>
                      <span style={{ fontWeight: selectedAgreement === agr.name ? 700 : 500, color: '#334155' }}>
                        {agr.name} {selectedAgreement === agr.name && '(Filter Active)'}
                      </span>
                      <span style={{ fontWeight: 600, color: MUTED }}>
                        {agr.count} ({agr.percentage}%)
                      </span>
                    </Box>
                    <Box sx={{ height: 6, bgcolor: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                      <Box
                        sx={{
                          height: '100%',
                          width: `${agr.percentage}%`,
                          bgcolor: SECTOR_PALETTE[(idx + 2) % SECTOR_PALETTE.length],
                          borderRadius: 3,
                        }}
                      />
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>

            <Box sx={{ mt: 1.5, p: 1.25, bgcolor: '#f8fafc', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: 1 }}>
              <InfoOutlinedIcon sx={{ fontSize: 16, color: MUTED }} />
              <Typography sx={{ fontSize: '11.5px', color: MUTED }}>
                <strong>Tip:</strong> Click any sector or agreement row above to instantly scope vector retrieval to that domain.
              </Typography>
            </Box>
          </Box>
        </Collapse>
      </Paper>

      {/* ── Filters & Scope Bar ── */}
      <Paper
        variant="outlined"
        sx={{
          p: 2,
          borderRadius: '10px',
          borderColor: hasActiveFilters ? '#93c5fd' : BORDER,
          bgcolor: hasActiveFilters ? '#f0f7ff' : '#ffffff',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <FilterListOutlinedIcon sx={{ fontSize: 18, color: NAVY }} />
          <Typography sx={{ fontSize: '13px', fontWeight: 700, color: '#1e293b' }}>
            Domain Scope:
          </Typography>
        </Box>

        {/* Sector Dropdown */}
        <FormControl size="small" sx={{ minWidth: 220, bgcolor: '#ffffff' }}>
          <InputLabel sx={{ fontSize: '12px' }}>Sectorial Category</InputLabel>
          <Select
            value={selectedSector}
            label="Sectorial Category"
            onChange={(e) => setSelectedSector(e.target.value)}
            sx={{ fontSize: '12.5px', borderRadius: '6px' }}
          >
            <MenuItem value="All">
              <em>All Sectors ({currentPoints} clauses)</em>
            </MenuItem>
            {SECTORIAL_OPTIONS.map((sec) => (
              <MenuItem key={sec} value={sec} sx={{ fontSize: '12.5px' }}>
                {sec}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Agreement Type Dropdown */}
        <FormControl size="small" sx={{ minWidth: 220, bgcolor: '#ffffff' }}>
          <InputLabel sx={{ fontSize: '12px' }}>Agreement Type</InputLabel>
          <Select
            value={selectedAgreement}
            label="Agreement Type"
            onChange={(e) => setSelectedAgreement(e.target.value)}
            sx={{ fontSize: '12.5px', borderRadius: '6px' }}
          >
            <MenuItem value="All">
              <em>All Agreement Types</em>
            </MenuItem>
            {AGREEMENT_TYPES.map((agr) => (
              <MenuItem key={agr} value={agr} sx={{ fontSize: '12.5px' }}>
                {agr}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {hasActiveFilters && (
          <Button
            size="small"
            onClick={handleClearFilters}
            startIcon={<ClearIcon sx={{ fontSize: 14 }} />}
            sx={{
              textTransform: 'none',
              fontSize: '11.5px',
              color: '#dc2626',
              fontWeight: 600,
              py: 0.5,
              '&:hover': { bgcolor: '#fee2e2' },
            }}
          >
            Reset Filters
          </Button>
        )}
      </Paper>

      {/* ── Input & Quick-Picks ── */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', gap: 1 }}>
          <Typography sx={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>
            Clause to test:
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '11.5px', color: MUTED, mr: 0.5 }}>
              Quick test samples:
            </Typography>
            {SAMPLE_CLAUSES.map((sample) => (
              <Chip
                key={sample.label}
                label={sample.label}
                size="small"
                onClick={() => handleQuickSample(sample)}
                clickable
                sx={{
                  fontSize: '11px',
                  height: 22,
                  bgcolor: '#ffffff',
                  borderColor: BORDER,
                  borderWidth: 1,
                  borderStyle: 'solid',
                  color: NAVY,
                  fontWeight: 500,
                  '&:hover': { bgcolor: '#f0f4f8', borderColor: NAVY },
                }}
              />
            ))}
          </Box>
        </Box>
        <TextField
          id="vp-clause-input"
          multiline
          minRows={4}
          maxRows={12}
          fullWidth
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste an ad-hoc clause text here… or click a quick test sample above (Ctrl+Enter to run)"
          helperText={`${inputText.length} / 8000 characters`}
          inputProps={{ maxLength: 8000 }}
          sx={{
            '& .MuiOutlinedInput-root': {
              bgcolor: '#ffffff',
              fontSize: '13.5px',
              lineHeight: 1.6,
              '& fieldset': { borderColor: BORDER },
              '&:hover fieldset': { borderColor: NAVY },
              '&.Mui-focused fieldset': { borderColor: NAVY },
            },
            '& .MuiFormHelperText-root': { color: MUTED, fontSize: '11.5px' },
          }}
        />
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1.25 }}>
          <Button
            id="vp-analyze-btn"
            variant="contained"
            disabled={!inputText.trim() || loading}
            onClick={() => handleAnalyze()}
            startIcon={loading ? <CircularProgress size={15} sx={{ color: '#fff' }} /> : <SendOutlinedIcon />}
            sx={{
              bgcolor: NAVY,
              fontWeight: 600,
              fontSize: '13px',
              px: 3,
              py: 1,
              borderRadius: '7px',
              textTransform: 'none',
              boxShadow: 'none',
              '&:hover': { bgcolor: '#1a3254', boxShadow: 'none' },
              '&.Mui-disabled': { bgcolor: '#cbd5e1', color: '#ffffff' },
            }}
          >
            {loading ? 'Evaluating Quality & Coverage…' : 'Run Diagnostics'}
          </Button>
        </Box>
      </Box>

      {/* ── Error ── */}
      {error && (
        <Alert severity="error" sx={{ borderRadius: '8px', fontSize: '13px' }}>
          {error}
        </Alert>
      )}

      {/* ── Results ── */}
      {result && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>

          {/* Blindspot warning (Idea 1) */}
          {pred?.blindspot_warning?.detected && (
            <Alert
              severity="warning"
              icon={<WarningAmberRoundedIcon fontSize="inherit" />}
              sx={{ borderRadius: '8px', fontSize: '13px', fontWeight: 500 }}
            >
              {pred.blindspot_warning.message}
            </Alert>
          )}

          {/* ── NEW: Quality & Coverage Intelligence Scorecard ── */}
          {covQual && (
            <Paper
              variant="outlined"
              sx={{
                p: 2.5,
                borderRadius: '10px',
                borderColor: BORDER,
                bgcolor: '#ffffff',
                boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <BarChartOutlinedIcon sx={{ fontSize: 20, color: NAVY }} />
                  <Typography sx={{ fontWeight: 700, fontSize: '15px', color: '#1b1f24' }}>
                    Clause Quality & Library Coverage Analytics
                  </Typography>
                </Box>
                <Chip
                  label={covQual.coverage?.maturity_label || 'Early Stage Corpus'}
                  size="small"
                  sx={{ bgcolor: '#eff6ff', color: NAVY, fontSize: '11px', fontWeight: 600 }}
                />
              </Box>

              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
                {/* 1. Quality Alignment Scorecard */}
                <Box sx={{ p: 2, bgcolor: '#f8fafc', borderRadius: '8px', border: `1px solid ${BORDER}` }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                    <Box>
                      <Typography sx={{ fontSize: '11px', color: MUTED, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                        Semantic Fit Quality
                      </Typography>
                      <Typography sx={{ fontSize: '24px', fontWeight: 800, color: confidenceColor(covQual.quality?.top_similarity ?? 0), lineHeight: 1.2 }}>
                        {((covQual.quality?.top_similarity ?? 0) * 100).toFixed(1)}%
                      </Typography>
                    </Box>
                    <Chip
                      label={covQual.quality?.label}
                      size="small"
                      sx={{
                        bgcolor: covQual.quality?.band === 'high' ? '#dcfce7' : covQual.quality?.band === 'moderate' ? '#fef3c7' : '#fee2e2',
                        color: covQual.quality?.band === 'high' ? '#15803d' : covQual.quality?.band === 'moderate' ? '#b45309' : '#dc2626',
                        fontWeight: 700,
                        fontSize: '11px',
                      }}
                    />
                  </Box>

                  {/* Graphical Spectrum */}
                  <SimilaritySpectrum
                    topScore={covQual.quality?.top_similarity ?? 0}
                    scores={covQual.quality?.score_distribution ?? []}
                    band={covQual.quality?.band}
                  />

                  <Typography sx={{ fontSize: '12px', color: '#475569', lineHeight: 1.5 }}>
                    {covQual.quality?.description}
                  </Typography>
                  <Typography sx={{ fontSize: '11px', color: MUTED, mt: 0.75 }}>
                    Top-3 Matches Average: <strong>{((covQual.quality?.top_3_average ?? 0) * 100).toFixed(1)}%</strong>
                  </Typography>
                </Box>

                {/* 2. Corpus Coverage Scorecard */}
                <Box sx={{ p: 2, bgcolor: '#f8fafc', borderRadius: '8px', border: `1px solid ${BORDER}` }}>
                  <Typography sx={{ fontSize: '11px', color: MUTED, textTransform: 'uppercase', letterSpacing: '0.4px', mb: 0.5 }}>
                    Corpus Representation Depth
                  </Typography>

                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1 }}>
                    <Typography sx={{ fontSize: '24px', fontWeight: 800, color: '#1e293b' }}>
                      {covQual.coverage?.count_in_library ?? 0}
                    </Typography>
                    <Typography sx={{ fontSize: '12.5px', color: MUTED }}>
                      clauses of type <code>{covQual.coverage?.canonical_type}</code> ({covQual.coverage?.percentage_of_library}% of library)
                    </Typography>
                  </Box>

                  <Divider sx={{ my: 1, borderColor: '#e2e8f0' }} />

                  {/* Document Spread */}
                  <Box sx={{ mb: 1.5 }}>
                    <Typography sx={{ fontSize: '11.5px', fontWeight: 600, color: '#334155', mb: 0.5 }}>
                      Contract Breadth: Sourced across {covQual.coverage?.document_spread} of {covQual.coverage?.total_documents} contracts
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {covQual.coverage?.document_names?.map((dName) => (
                        <Chip
                          key={dName}
                          label={dName}
                          size="small"
                          sx={{ fontSize: '10.5px', height: 20, bgcolor: '#e2e8f0', color: '#1e293b' }}
                        />
                      ))}
                    </Box>
                  </Box>

                  {/* Matched Sector Distribution */}
                  {covQual.matched_distributions?.sectors?.length > 0 && (
                    <Box>
                      <Typography sx={{ fontSize: '11.5px', fontWeight: 600, color: '#334155', mb: 0.5 }}>
                        Top Matches Sector Presence:
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {covQual.matched_distributions.sectors.map((s) => (
                          <Chip
                            key={s.name}
                            label={`${s.name}: ${s.count}`}
                            size="small"
                            sx={{ fontSize: '10.5px', height: 19, bgcolor: '#f1f5f9', color: '#475569' }}
                          />
                        ))}
                      </Box>
                    </Box>
                  )}
                </Box>
              </Box>
            </Paper>
          )}

          {/* Prediction card */}
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: '10px', borderColor: BORDER, bgcolor: '#ffffff' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
              <CheckCircleOutlineRoundedIcon sx={{ fontSize: 18, color: pred?.needs_review ? '#d97706' : '#16a34a' }} />
              <Typography sx={{ fontWeight: 700, fontSize: '14px', color: '#1b1f24' }}>
                Classification Verdict
              </Typography>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 2 }}>
              <Box>
                <Typography sx={{ fontSize: '11px', color: MUTED, textTransform: 'uppercase', letterSpacing: '0.4px', mb: 0.5 }}>Label</Typography>
                <Chip
                  label={pred?.label}
                  sx={{
                    bgcolor: pred?.label === 'Clause' ? '#dcfce7' : '#f0f4f8',
                    color: pred?.label === 'Clause' ? '#15803d' : NAVY,
                    fontWeight: 700,
                    fontSize: '13px',
                  }}
                />
              </Box>
              <Box>
                <Typography sx={{ fontSize: '11px', color: MUTED, textTransform: 'uppercase', letterSpacing: '0.4px', mb: 0.5 }}>Canonical Type</Typography>
                <Typography sx={{ fontSize: '14px', fontWeight: 600, color: '#1b1f24' }}>
                  {pred?.canonical_type || '—'}
                </Typography>
                {pred?.sub_type && (
                  <Typography sx={{ fontSize: '11.5px', color: MUTED }}>{pred.sub_type}</Typography>
                )}
              </Box>
              <Box>
                <Typography sx={{ fontSize: '11px', color: MUTED, textTransform: 'uppercase', letterSpacing: '0.4px', mb: 0.5 }}>
                  {isBm25Only ? 'Keyword Match' : 'Confidence'}
                </Typography>
                <Typography sx={{ fontSize: '22px', fontWeight: 800, color: confidenceColor(pred?.confidence ?? 0), lineHeight: 1 }}>
                  {((pred?.confidence ?? 0) * 100).toFixed(1)}%
                </Typography>
                <Typography sx={{ fontSize: '11.5px', color: confidenceColor(pred?.confidence ?? 0), fontWeight: 600 }}>
                  {confidenceLabel(pred?.confidence ?? 0)}
                </Typography>
                {isBm25Only && (
                  <Typography sx={{ fontSize: '10.5px', color: MUTED, mt: 0.5, lineHeight: 1.3 }}>
                    Keyword overlap score (≤65%). Dense embedding offline — start EC2 for cosine similarity.
                  </Typography>
                )}
              </Box>
            </Box>

            {pred?.reason && (
              <Box sx={{ mt: 2, pt: 1.5, borderTop: `1px solid ${BORDER}` }}>
                <Typography sx={{ fontSize: '12px', color: MUTED, fontStyle: 'italic' }}>
                  {pred.reason}
                </Typography>
              </Box>
            )}
          </Paper>

          {/* Retrieval matrix (Idea 4) */}
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: '10px', borderColor: BORDER, bgcolor: '#ffffff' }}>
            <Typography sx={{ fontWeight: 700, fontSize: '14px', color: '#1b1f24', mb: 2 }}>
              Retrieval Matrix
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.5, mb: 2 }}>
              {[
                {
                  label: isBm25Only ? 'Keyword Match Score' : 'Dense Score',
                  value: matrix?.dense_score != null ? (matrix.dense_score * 100).toFixed(1) + '%' : '—',
                  sub: isBm25Only ? 'Jaccard overlap (≤65% max)' : `Rank #${matrix?.dense_rank ?? '—'}`,
                },
                { label: 'BM25 Score', value: matrix?.bm25_score != null ? matrix.bm25_score.toFixed(3) : '—', sub: `Rank #${matrix?.bm25_rank ?? '—'}` },
                { label: 'RRF Score', value: matrix?.rrf_score != null ? matrix.rrf_score.toFixed(5) : '—', sub: `Found by ${matrix?.found_by ?? '—'}` },
              ].map(({ label, value, sub }) => (
                <Box key={label} sx={{ p: 1.25, bgcolor: '#f8fafc', borderRadius: '7px', textAlign: 'center' }}>
                  <Typography sx={{ fontSize: '11px', color: MUTED, mb: 0.25 }}>{label}</Typography>
                  <Typography sx={{ fontSize: '18px', fontWeight: 800, color: '#1b1f24' }}>{value}</Typography>
                  <Typography sx={{ fontSize: '11px', color: MUTED }}>{sub}</Typography>
                </Box>
              ))}
            </Box>
            <Typography sx={{ fontSize: '11.5px', color: MUTED }}>
              Library size: <strong>{matrix?.library_size?.toLocaleString() ?? '—'}</strong> vectors indexed
            </Typography>
          </Paper>

          {/* Latency breakdown (Idea 4) */}
          {perf && (
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: '10px', borderColor: BORDER, bgcolor: '#ffffff' }}>
              <Typography sx={{ fontWeight: 700, fontSize: '14px', color: '#1b1f24', mb: 2 }}>
                Latency Breakdown
              </Typography>
              {[
                { label: 'BGE-M3 Embed', key: 'embed_ms' },
                { label: 'Dense Search', key: 'dense_search_ms' },
                { label: 'BM25 Index', key: 'bm25_ms' },
                { label: 'RRF Blend', key: 'rrf_ms' },
                { label: 'Taxonomy Lookup', key: 'taxonomy_ms' },
              ].map(({ label, key }) => (
                <LatencyBar key={key} label={label} value={perf[key] ?? 0} max={perf.total_ms || 1} />
              ))}
              <Divider sx={{ my: 1, borderColor: BORDER }} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography sx={{ fontSize: '12.5px', fontWeight: 700, color: '#1b1f24' }}>Total</Typography>
                <Typography sx={{ fontSize: '12.5px', fontWeight: 700, color: NAVY }}>{perf.total_ms} ms</Typography>
              </Box>
            </Paper>
          )}

          {/* Library matches (Idea 2 – keyword diff) */}
          {result.library_matches?.length > 0 && (
            <Box>
              <Typography sx={{ fontWeight: 700, fontSize: '14px', color: '#1b1f24', mb: 1.25 }}>
                Top Library Matches
                <Typography component="span" sx={{ fontWeight: 400, fontSize: '12px', color: MUTED, ml: 1 }}>
                  · highlighted tokens are shared keywords with your input
                </Typography>
              </Typography>
              {result.library_matches.map((m) => (
                <MatchCard key={m.vector_id} match={m} />
              ))}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
