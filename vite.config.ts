import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Hosted at a domain root (Netlify), so the service worker sits at /sw.js and its
      // scope covers the whole app. Vite's own `base` stays relative — see below.
      base: '/',
      scope: '/',

      // 'prompt', not 'autoUpdate': a layout lives only in memory until you save it, so a
      // background reload would throw away the bench someone is drawing. The new build
      // waits until they click Reload — see components/UpdatePrompt.tsx.
      registerType: 'prompt',

      // Registration is done by hand in UpdatePrompt so it can be skipped under file://,
      // which is how the Electron build loads the same dist/.
      injectRegister: false,

      // No service worker in dev; stale caches during development are pure confusion.
      devOptions: { enabled: false },

      workbox: {
        // The whole app is 500 kB and makes no network calls at runtime, so precaching
        // everything is both cheap and enough for full offline use.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // icons.svg is a leftover sprite nothing references; no reason to ship it offline.
        globIgnores: ['**/icons.svg'],
        // Single page, no router: any navigation resolves to the one document.
        navigateFallback: 'index.html',
      },

      // The icons are already caught by globPatterns above; letting the plugin add them
      // again just lists the same five URLs twice in the precache manifest.
      includeManifestIcons: false,

      manifest: {
        id: '/',
        start_url: '/',
        name: 'OpticaLab — Optical System Designer',
        short_name: 'OpticaLab',
        description: 'Design free-space optical layouts with real beam physics: Gaussian modes, polarisation and acousto-optic diffraction.',
        display: 'standalone',
        // Matches the app's own background, so the window does not flash white on launch.
        theme_color: '#0f1117',
        background_color: '#0f1117',
        categories: ['productivity', 'education', 'utilities'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          // Padded, so Android can crop it to a circle or squircle without clipping.
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],

  // Relative, deliberately: the Electron build loads dist/index.html over file://, where
  // an absolute base would resolve assets against the filesystem root. It also lets the
  // built folder be served from a subpath. The PWA plugin is given '/' explicitly above,
  // because a service worker's scope cannot be relative.
  base: './',
  server: {
    port: 7432,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
  },
})
