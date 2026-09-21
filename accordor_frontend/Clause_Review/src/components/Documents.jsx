import React from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Chip,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Tooltip,
  IconButton,
} from '@mui/material';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import SyncIcon from '@mui/icons-material/Sync';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

export default function Documents({
  driveState = {},
  documents = [],
  _onOpenPicker,
  _onConnectDrive,
  onCheckDrive,
  onViewDocument,
  isEmptyData = false,
}) {
  return (
    <Box
      sx={{
        flex: 1,
        overflowY: 'auto',
        p: { xs: 2.5, sm: 3.5, md: 4.5 },
        display: 'flex',
        flexDirection: 'column',
        gap: 2.75,
        backgroundColor: '#fafaf8',
      }}
    >
      {/* Page Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography
            variant="h5"
            sx={{
              fontWeight: 700,
              color: '#1b1f24',
              letterSpacing: '-0.02em',
            }}
          >
            Documents
          </Typography>
          <Typography variant="body2" sx={{ color: '#7b838c' }}>
            {driveState.folderPath
              ? `Contracts and legal documents synced from Google Drive folder "${driveState.folderPath}".`
              : 'Contracts and legal documents synced from your connected Google Drive folder.'}
          </Typography>
        </Box>

        {driveState.isConnected && onCheckDrive && (
          <Button
            variant="outlined"
            size="small"
            onClick={onCheckDrive}
            disabled={driveState.isSyncing}
            startIcon={<SyncIcon sx={{ fontSize: 16, animation: driveState.isSyncing ? 'spin 1s linear infinite' : 'none' }} />}
            sx={{
              borderColor: '#cfcfc8',
              color: '#1b1f24',
              fontWeight: 600,
              fontSize: '12.5px',
              textTransform: 'none',
              bgcolor: '#ffffff',
              '&:hover': { bgcolor: '#f5f5f2', borderColor: '#b9cde0' },
              '@keyframes spin': {
                '0%': { transform: 'rotate(0deg)' },
                '100%': { transform: 'rotate(360deg)' },
              },
            }}
          >
            {driveState.isSyncing ? 'Syncing...' : 'Sync files'}
          </Button>
        )}
      </Box>

      {/* Documents Table Section */}
      <Paper
        elevation={0}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1.75,
          p: 2.5,
          bgcolor: '#ffffff',
          border: '1px solid #e3e3de',
          borderRadius: 2,
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
          minWidth: 0,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#1b1f24', fontSize: '14px' }}>
              Files in Google Drive
            </Typography>
            <Chip
              label={`${isEmptyData ? 0 : documents.length} files`}
              size="small"
              sx={{
                height: 20,
                fontSize: '11px',
                bgcolor: '#f5f5f2',
                color: '#4a5159',
                border: '1px solid #e3e3de',
              }}
            />
          </Box>
        </Box>

        {isEmptyData || documents.length === 0 ? (
          <Box
            sx={{
              flex: 1,
              minHeight: 320,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              p: { xs: 3, sm: 5 },
              bgcolor: '#fafaf8',
              border: '1.5px dashed #cfcfc8',
              borderRadius: 2,
              gap: 1.5,
            }}
          >
            <Box
              sx={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                bgcolor: '#f5f5f2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#7b838c',
              }}
            >
              <DescriptionOutlinedIcon sx={{ fontSize: 26 }} />
            </Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#1b1f24', fontSize: '15px' }}>
              No documents found
            </Typography>
            <Typography variant="body2" sx={{ color: '#7b838c', maxWidth: 360, lineHeight: 1.5 }}>
              {driveState.isConnected
                ? (driveState.folderPath
                    ? `No new contracts found in "${driveState.folderPath}". Upload PDF or DOCX files to this folder or click "Sync files".`
                    : 'Select a Google Drive folder from the Overview section to begin reviewing contracts.')
                : 'Connect your Google Drive account from the Overview section to select folders and fetch contracts for review.'}
            </Typography>
          </Box>
        ) : (
          <TableContainer sx={{ width: '100%', borderRadius: 1.5, border: '1px solid #e3e3de' }}>
            <Table size="small">
              <TableHead sx={{ bgcolor: '#f5f5f2' }}>
                <TableRow>
                  <TableCell sx={{ fontSize: '11.5px', fontWeight: 600, color: '#7b838c', py: 1 }}>Document Name</TableCell>
                  <TableCell sx={{ fontSize: '11.5px', fontWeight: 600, color: '#7b838c', py: 1 }}>Folder</TableCell>
                  <TableCell sx={{ fontSize: '11.5px', fontWeight: 600, color: '#7b838c', py: 1 }}>Agreement Type</TableCell>
                  <TableCell sx={{ fontSize: '11.5px', fontWeight: 600, color: '#7b838c', py: 1 }}>Sectorial</TableCell>
                  <TableCell sx={{ fontSize: '11.5px', fontWeight: 600, color: '#7b838c', py: 1 }}>Status</TableCell>
                  <TableCell sx={{ fontSize: '11.5px', fontWeight: 600, color: '#7b838c', py: 1 }}>Size</TableCell>
                  <TableCell sx={{ fontSize: '11.5px', fontWeight: 600, color: '#7b838c', py: 1 }}>Modified</TableCell>
                  <TableCell align="right" sx={{ fontSize: '11.5px', fontWeight: 600, color: '#7b838c', py: 1 }}>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id || doc.name} hover sx={{ '&:hover': { bgcolor: '#fafaf8' } }}>
                    <TableCell sx={{ py: 1.25 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <DescriptionOutlinedIcon sx={{ fontSize: 16, color: '#1e3a5f', flexShrink: 0 }} />
                        <Typography
                          title={doc.name}
                          sx={{
                            fontSize: '12.5px',
                            fontWeight: 500,
                            color: '#1b1f24',
                            maxWidth: { xs: 140, sm: 200, md: 260 },
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {doc.name}
                        </Typography>
                        {doc.webViewLink && (
                          <Tooltip title="Open in Google Drive" arrow>
                            <IconButton
                              size="small"
                              component="a"
                              href={doc.webViewLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              sx={{ p: 0.3, color: '#7b838c', '&:hover': { color: '#1e3a5f' } }}
                            >
                              <OpenInNewIcon sx={{ fontSize: 13 }} />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Box>
                    </TableCell>
                    <TableCell sx={{ py: 1.25 }}>
                      <Typography
                        title={doc.folder || driveState.folderPath || 'Drive Folder'}
                        sx={{
                          fontSize: '12px',
                          color: '#4a5159',
                          maxWidth: 120,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {doc.folder || driveState.folderPath || 'Drive Folder'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ py: 1.25 }}>
                      <Chip
                        label={doc.agreementType || driveState.agreementType || 'General'}
                        size="small"
                        sx={{
                          height: 20,
                          fontSize: '11px',
                          bgcolor: '#edf2f7',
                          color: '#1e3a5f',
                          fontWeight: 500,
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ py: 1.25 }}>
                      <Chip
                        label={doc.sectorial || driveState.sectorial || 'Cross-Sector'}
                        size="small"
                        sx={{
                          height: 20,
                          fontSize: '11px',
                          bgcolor: '#f5f5f2',
                          color: '#4a5159',
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ py: 1.25 }}>
                      <Chip
                        label={doc.status || 'Needs review'}
                        size="small"
                        sx={{
                          height: 20,
                          fontSize: '11px',
                          bgcolor: '#f1f3f4',
                          color: '#3c4043',
                          fontWeight: 500,
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ py: 1.25, fontSize: '12px', color: '#7b838c' }}>{doc.size || '1.4 MB'}</TableCell>
                    <TableCell sx={{ py: 1.25, fontSize: '12px', color: '#7b838c' }}>{doc.modifiedTime || 'Today'}</TableCell>
                    <TableCell align="right" sx={{ py: 1.25 }}>
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => onViewDocument && onViewDocument(doc)}
                        sx={{
                          fontSize: '11.5px',
                          py: 0.25,
                          px: 1.25,
                          textTransform: 'none',
                          borderColor: '#cfcfc8',
                          color: '#1b1f24',
                          bgcolor: '#ffffff',
                          '&:hover': { bgcolor: '#f5f5f2', borderColor: '#1e3a5f' },
                        }}
                      >
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Box>
  );
}
