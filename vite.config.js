import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { getBuildInfo } from './scripts/version.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt': la app avisa de la nueva versión y el usuario decide cuándo recargar
      // (ver src/components/PWAPrompts.jsx); así no se pierde un chat o un formulario a medias.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['logo.png', 'apple-touch-icon-180x180.png'],
      manifest: {
        id: '/',
        name: 'RunAnalyzer — AI Running Analytics',
        short_name: 'RunAnalyzer',
        description: 'Análisis inteligente de tu entrenamiento de running con IA: tendencias, predicción de carreras y planes personalizados.',
        lang: 'es',
        start_url: '/?source=pwa',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#07090d',
        theme_color: '#f6f7f9',
        categories: ['sports', 'health', 'fitness'],
        launch_handler: { client_mode: ['navigate-existing', 'auto'] },
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Capturas: activan el diálogo de instalación enriquecido de Chrome (estilo tienda).
        screenshots: [
          { src: 'screenshots/narrow.png', sizes: '1080x1920', type: 'image/png', form_factor: 'narrow', label: 'RunAnalyzer en el móvil' },
          { src: 'screenshots/wide.png', sizes: '1920x1080', type: 'image/png', form_factor: 'wide', label: 'Dashboard de entrenamiento' },
        ],
        // Accesos directos: clic derecho en el icono del escritorio / pulsación larga en Android.
        shortcuts: [
          { name: 'Dashboard', url: '/dashboard?source=pwa', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] },
          { name: 'Carga (PMC)', url: '/pmc?source=pwa', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] },
          { name: 'Semana', url: '/weekly?source=pwa', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] },
          { name: 'Planificador', url: '/planner?source=pwa', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Capturas: solo las usa el diálogo de instalación. Librerías pesadas y de uso
        // ocasional (diagramas, PDF, fórmulas): se cachean al usarse (ver runtimeCaching).
        globIgnores: [
          'screenshots/**',
          'images/**',
          'assets/{mermaid,cytoscape,katex,jspdf,html2canvas,cynefin}*',
          'assets/*{Diagram,diagram}*',
          'assets/*-definition-*',
          'assets/{dagre,cose-bilkent,swimlanes,sizeCapture,chunk,AdminPanel}-*',
        ],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/index.html',
        // Nunca servir desde caché la API, el OAuth ni los callbacks: datos y tokens siempre frescos.
        navigateFallbackDenylist: [/^\/api\//, /^\/\.well-known\//, /^\/strava-callback/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Chunks con hash en el nombre: inmutables, se guardan la primera vez que se piden.
            urlPattern: ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/assets/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'lazy-chunks',
              expiration: { maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 60 },
            },
          },
          {
            urlPattern: ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/images/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'app-images', expiration: { maxEntries: 60 } },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css' },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Fotos de perfil/actividades (Strava CDN, etc.): útiles offline, caducan solas.
            // Fuera las teselas de mapa (/z/x/y): son respuestas opacas y cada una cuenta
            // como varios MB de cuota en Chrome.
            urlPattern: ({ request, url }) => request.destination === 'image' && url.origin !== self.location.origin && !/\/\d+\/\d+\/\d+/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'remote-images',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  // Versión derivada de git en tiempo de build: cada commit produce una versión.
  define: {
    __BUILD_INFO__: JSON.stringify(getBuildInfo()),
  },
  build: {
    rollupOptions: {
      output: {
        // Vendors grandes en chunks propios: el bundle de la app se cachea
        // aparte de las librerías, que cambian mucho menos entre despliegues.
        //
        // Función y no objeto: la forma de objeto solo captura el punto de
        // entrada del paquete, y `react-dom/client` + `scheduler` se quedaban en
        // el chunk de la app (~530 kB que se re-descargaban en cada deploy).
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          const pkg = (name) => id.includes(`/node_modules/${name}/`);
          if (['react', 'react-dom', 'scheduler', 'react-router', 'react-router-dom'].some(pkg)) return 'react';
          // i18n va con React: en un chunk aparte se creaba un ciclo de imports y
          // react-i18next se evaluaba antes que React ("reading 'createContext'").
          if (['i18next', 'react-i18next'].some(pkg)) return 'react';
          // recharts y tremor NO van a mano: comparten dependencias (d3, lodash,
          // victory-vendor…) con el resto y, forzados a su propio chunk, se creaba
          // un ciclo que evaluaba recharts a medias ("Cannot access 'm2' before
          // initialization"). Rollup los reparte bien solo.
          if (pkg('framer-motion')) return 'motion';
          if (pkg('@supabase')) return 'supabase';
          return undefined;
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
