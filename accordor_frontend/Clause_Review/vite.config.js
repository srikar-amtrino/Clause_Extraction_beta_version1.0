import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    include: [
      '@mui/material',
      '@mui/icons-material',
      '@mui/icons-material/Visibility',
      '@mui/icons-material/VisibilityOff',
      '@mui/icons-material/PersonOutlined',
      '@mui/icons-material/Search',
      '@mui/icons-material/Sync',
      '@mui/icons-material/Article',
      '@mui/icons-material/CheckCircleOutlined',
      '@mui/icons-material/DescriptionOutlined',
      '@mui/icons-material/EmailOutlined',
      '@mui/icons-material/FlashOn',
      '@mui/icons-material/LockOutlined',
      '@mui/icons-material/OpenInNew',
      '@mui/icons-material/Security',
      '@mui/icons-material/WorkOutline',
    ],
  },
})