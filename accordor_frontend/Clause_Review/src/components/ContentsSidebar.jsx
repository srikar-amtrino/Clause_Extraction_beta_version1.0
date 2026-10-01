import React from 'react';
import { Box, Typography, IconButton } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

export default function ContentsSidebar({
  isOpen,
  onClose,
  contentsTree = [],
  expandedSections,
  onToggleSection,
  highlightedClauseId,
  onSectionClick,
  onClauseClick,
}) {
  if (!isOpen) return null;

  return (
    <Box
      sx={{
        width: { xs: 260, sm: 285, md: 300 },
        minWidth: { xs: 260, sm: 285, md: 300 },
        maxWidth: { xs: 290, sm: 310, md: 330 },
        height: '100%',
        borderRight: '1px solid #e3e3de',
        bgcolor: '#fafaf8',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        zIndex: 6,
        boxShadow: '2px 0 8px rgba(0,0,0,0.03)',
        overflowY: 'auto',
      }}
    >
      {/* Contents Panel Header */}
      <Box sx={{ p: 2, pb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
          <IconButton
            size="small"
            onClick={onClose}
            sx={{
              p: 0.5,
              color: '#1e293b',
              '&:hover': { bgcolor: '#f1f5f9' },
            }}
          >
            <ArrowBackIcon sx={{ fontSize: 20 }} />
          </IconButton>
          <Typography sx={{ fontSize: '15px', fontWeight: 600, color: '#1b1f24', letterSpacing: '-0.01em' }}>
            Contents
          </Typography>
        </Box>
      </Box>

      {/* Tree outline list */}
      <Box sx={{ flex: 1, px: 1.5, pb: 3, overflowY: 'auto' }}>
        {contentsTree.length === 0 ? (
          <Box sx={{ py: 4, px: 2, textAlign: 'center', color: '#94a3b8' }}>
            <Typography sx={{ fontSize: '12px' }}>No sections or clauses available</Typography>
          </Box>
        ) : (
          <Box sx={{ position: 'relative', pl: 0.5 }}>
            {/* Subtle vertical guideline on left */}
            <Box
              sx={{
                position: 'absolute',
                left: 10,
                top: 4,
                bottom: 4,
                width: '1px',
                bgcolor: '#e2e8f0',
                zIndex: 0,
              }}
            />

            {contentsTree.map((sec) => {
              const isSecExpanded = expandedSections.has(sec.number);
              const isSecActive =
                highlightedClauseId &&
                (sec.children.some(
                  (c) =>
                    c.id === highlightedClauseId ||
                    c.clause_id === highlightedClauseId ||
                    c.paraId === highlightedClauseId
                ) ||
                  sec.firstClauseId === highlightedClauseId);

              return (
                <Box key={sec.key} sx={{ position: 'relative', zIndex: 1, mb: 0.5 }}>
                  {/* Section Item Header */}
                  <Box
                    onClick={() => onSectionClick(sec)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.75,
                      py: 0.75,
                      px: 1,
                      borderRadius: 1,
                      cursor: 'pointer',
                      bgcolor: isSecActive ? '#eff6ff' : 'transparent',
                      borderLeft: isSecActive ? '3px solid #0284c7' : '3px solid transparent',
                      color: isSecActive ? '#0284c7' : '#334155',
                      transition: 'all 0.15s ease',
                      '&:hover': {
                        bgcolor: isSecActive ? '#eff6ff' : '#f1f5f9',
                      },
                    }}
                  >
                    {/* Expand / Collapse Chevron */}
                    <Box
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSection(sec.number);
                      }}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 18,
                        height: 18,
                        borderRadius: 0.5,
                        color: '#64748b',
                        '&:hover': { color: '#0f172a', bgcolor: '#e2e8f0' },
                      }}
                    >
                      {isSecExpanded ? (
                        <KeyboardArrowDownIcon sx={{ fontSize: 16 }} />
                      ) : (
                        <ChevronRightIcon sx={{ fontSize: 16 }} />
                      )}
                    </Box>

                    {/* Section Title */}
                    <Typography
                      title={`${sec.number}. ${sec.title}`}
                      sx={{
                        fontSize: '12.5px',
                        fontWeight: isSecActive ? 700 : 600,
                        letterSpacing: '0.01em',
                        textTransform: 'uppercase',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                        fontFamily: "'IBM Plex Sans', -apple-system, sans-serif",
                      }}
                    >
                      {sec.number}. {sec.title}
                    </Typography>

                    {/* Count chip */}
                    <Typography sx={{ fontSize: '10.5px', color: '#94a3b8', pr: 0.5 }}>
                      ({sec.children.length})
                    </Typography>
                  </Box>

                  {/* Sub-items (1.1, 1.2, 1.3...) when expanded */}
                  {isSecExpanded && (
                    <Box sx={{ pl: 3, pt: 0.25, pb: 0.5 }}>
                      {sec.children.map((child) => {
                        const isChildActive =
                          highlightedClauseId &&
                          (child.id === highlightedClauseId ||
                            child.clause_id === highlightedClauseId ||
                            child.paraId === highlightedClauseId);

                        return (
                          <Box
                            key={child.id || child.number}
                            onClick={() => onClauseClick(child.clause)}
                            sx={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: 0.75,
                              py: 0.6,
                              px: 1,
                              my: 0.2,
                              borderRadius: 1,
                              cursor: 'pointer',
                              bgcolor: isChildActive ? '#dbeafe' : 'transparent',
                              borderLeft: isChildActive ? '2.5px solid #2563eb' : '2.5px solid transparent',
                              color: isChildActive ? '#1d4ed8' : '#475569',
                              transition: 'all 0.12s ease',
                              '&:hover': {
                                bgcolor: isChildActive ? '#dbeafe' : '#f1f5f9',
                                color: '#1e293b',
                              },
                            }}
                          >
                            {/* Number e.g. 1.1, 1.2 */}
                            <Typography
                              sx={{
                                fontSize: '11.5px',
                                fontWeight: isChildActive ? 700 : 600,
                                color: isChildActive ? '#1d4ed8' : '#64748b',
                                fontFamily: 'monospace',
                                flexShrink: 0,
                                minWidth: 26,
                              }}
                            >
                              {child.number}
                            </Typography>

                            {/* Title / snippet */}
                            <Typography
                              title={child.label}
                              sx={{
                                fontSize: '11.5px',
                                fontWeight: isChildActive ? 600 : 400,
                                lineHeight: 1.35,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                flex: 1,
                              }}
                            >
                              {child.label}
                            </Typography>
                          </Box>
                        );
                      })}
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    </Box>
  );
}
