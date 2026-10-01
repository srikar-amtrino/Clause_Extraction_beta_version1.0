import React from 'react';
import { Box, Typography, IconButton, Tooltip } from '@mui/material';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import CloseIcon from '@mui/icons-material/Close';

function formatBreadcrumbDisplay(text) {
  if (!text) return 'General';
  if (typeof text === 'string' && text === text.toUpperCase() && text.length > 2) {
    const match = text.match(/^(\d+[.)]\s*)(.+)$/);
    if (match) {
      const num = match[1];
      const rest = match[2].toLowerCase();
      return num + rest.charAt(0).toUpperCase() + rest.slice(1);
    }
    const lower = text.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }
  return text;
}

export default function DocumentPreviewPanel({
  isOpen,
  onClose,
  docName,
  docTitle,
  webViewLink,
  extractedClauses = [],
  previewClause,
  previewClauseIndex,
  onPrevClause,
  onNextClause,
  highlightedClauseId,
  onSelectClause,
  previewContainerRef,
}) {
  if (!isOpen) return null;

  return (
    <Box
      sx={{
        flex: { xs: '1 1 100%', md: '0 0 44%', lg: '0 0 42%' },
        maxWidth: { md: '50%', lg: '45%' },
        minWidth: { md: 380 },
        height: '100%',
        borderLeft: '1px solid #e3e3de',
        bgcolor: '#fafaf8',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '-3px 0 12px rgba(0,0,0,0.04)',
        zIndex: 5,
      }}
    >
      {/* Header of Document Preview Panel */}
      <Box
        sx={{
          px: 2,
          py: 1.25,
          borderBottom: '1px solid #e3e3de',
          bgcolor: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
          gap: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1 }}>
          <DescriptionOutlinedIcon sx={{ fontSize: 18, color: '#1e3a5f', flexShrink: 0 }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography
              sx={{
                fontSize: '13px',
                fontWeight: 700,
                color: '#1b1f24',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {docTitle || docName}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
          {/* Previous clause navigation */}
          <Tooltip title="Previous clause">
            <span>
              <IconButton
                size="small"
                disabled={previewClauseIndex <= 0}
                onClick={onPrevClause}
                sx={{ p: 0.5, color: '#64748b', '&:hover': { color: '#1e3a5f' } }}
              >
                <KeyboardArrowUpIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>

          {/* Next clause navigation */}
          <Tooltip title="Next clause">
            <span>
              <IconButton
                size="small"
                disabled={previewClauseIndex >= extractedClauses.length - 1}
                onClick={onNextClause}
                sx={{ p: 0.5, color: '#64748b', '&:hover': { color: '#1e3a5f' } }}
              >
                <KeyboardArrowDownIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>

          {webViewLink && (
            <Tooltip title="Open original in new tab">
              <IconButton
                size="small"
                onClick={() => window.open(webViewLink, '_blank')}
                sx={{ p: 0.5, color: '#64748b', '&:hover': { color: '#1e3a5f' } }}
              >
                <OpenInNewIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}

          <Tooltip title="Close preview">
            <IconButton
              size="small"
              onClick={onClose}
              sx={{ p: 0.5, color: '#64748b', ml: 0.5, '&:hover': { color: '#ef4444', bgcolor: '#fee2e2' } }}
            >
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Entire Document View */}
      <Box
        ref={previewContainerRef}
        sx={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'auto',
          bgcolor: '#fafaf8',
          p: { xs: 1.5, sm: 3 },
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        {/* Document Paper Sheet */}
        <Box
          sx={{
            bgcolor: '#ffffff',
            border: '1px solid #e3e3de',
            borderRadius: 1,
            boxShadow: '0 1px 6px rgba(0, 0, 0, 0.05)',
            p: { xs: 2.5, sm: 4, md: 5 },
            width: '100%',
            maxWidth: 800,
            minHeight: '100%',
            boxSizing: 'border-box',
          }}
        >
          {extractedClauses.length === 0 ? (
            <Typography sx={{ fontSize: '13px', color: '#94a3b8', textAlign: 'center', py: 6 }}>
              No document content available to preview.
            </Typography>
          ) : (
            extractedClauses.map((item, i) => {
              const targetId = item.clause_id || item.paraId || item.id || `clause-${i}`;
              const isHighlighted =
                (highlightedClauseId &&
                  (highlightedClauseId === item.clause_id ||
                    highlightedClauseId === item.paraId ||
                    highlightedClauseId === item.id ||
                    highlightedClauseId === targetId)) ||
                (previewClause &&
                  (previewClause.clause_id === item.clause_id ||
                    previewClause.paraId === item.paraId ||
                    previewClause.id === item.id ||
                    (previewClause.text &&
                      item.text &&
                      previewClause.text.trim() === item.text.trim())));

              const currentHeading = (item.heading_trail || item.breadcrumb || '').trim();
              const prevHeading =
                i > 0
                  ? (extractedClauses[i - 1].heading_trail || extractedClauses[i - 1].breadcrumb || '').trim()
                  : '';
              const showHeading = currentHeading && (i === 0 || currentHeading !== prevHeading);

              return (
                <Box key={item.id || targetId} sx={{ mb: 1.25 }}>
                  {showHeading && (
                    <Typography
                      sx={{
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#1e293b',
                        fontFamily: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                        mt: i === 0 ? 0 : 2,
                        mb: 0.5,
                        lineHeight: 1.35,
                      }}
                    >
                      {formatBreadcrumbDisplay(currentHeading)}
                    </Typography>
                  )}

                  {/* Paragraph / Clause with Blue Text Highlighter when selected */}
                  <Box
                    id={`doc-preview-clause-${targetId}`}
                    data-clause-id={item.clause_id || item.paraId}
                    onClick={() => onSelectClause(item)}
                    sx={{
                      my: 0.75,
                      px: 1,
                      py: 0.5,
                      bgcolor: isHighlighted ? '#dbeafe' : 'transparent',
                      borderLeft: isHighlighted ? '4px solid #2563eb' : '4px solid transparent',
                      borderRadius: '3px',
                      boxShadow: isHighlighted ? '0 1px 4px rgba(37, 99, 235, 0.2)' : 'none',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      '&:hover': {
                        bgcolor: isHighlighted ? '#dbeafe' : '#f8fafc',
                      },
                    }}
                  >
                    <Typography
                      component="p"
                      sx={{
                        fontSize: '12.5px',
                        color: isHighlighted ? '#1d4ed8' : '#1e293b',
                        fontWeight: isHighlighted ? 600 : 400,
                        lineHeight: 1.65,
                        fontFamily: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        textAlign: 'left',
                      }}
                    >
                      {item.text || '[Empty clause]'}
                    </Typography>
                  </Box>
                </Box>
              );
            })
          )}
        </Box>
      </Box>
    </Box>
  );
}
