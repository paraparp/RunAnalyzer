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
  build: {
    rollupOptions: {
      output: {
        // Vendors grandes en chunks propios: el bundle de la app se cachea
        // aparte de las librerías, que cambian mucho menos entre despliegues.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          recharts: ['recharts'],
          tremor: ['@tremor/react'],
          motion: ['framer-motion'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
