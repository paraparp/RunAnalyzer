import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { getBuildInfo } from './scripts/version.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Versión derivada de git en tiempo de build: cada commit produce una versión.
  define: {
    __BUILD_INFO__: JSON.stringify(getBuildInfo()),
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
