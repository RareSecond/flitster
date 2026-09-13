import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'

const pwaPlugins = VitePWA({
  registerType: 'autoUpdate',
  injectRegister: false,
  outDir: 'dist/client',
  workbox: {
    clientsClaim: true,
    skipWaiting: true,
    navigateFallback: '/_shell.html',
    navigateFallbackDenylist: [/^\/_serverFn\//, /^\/api\//],
    globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
  },
  devOptions: { enabled: true, type: 'module' },
  manifest: {
    name: 'Flitster',
    short_name: 'Flitster',
    description: 'QR -> flip -> play. PWA feasibility prototype.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0b0b0f',
    theme_color: '#0b0b0f',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
})

// HTTPS is mandatory on a phone: camera (getUserMedia) and the motion sensors
// both require a secure context. basicSsl gives a self-signed cert for LAN testing.
export default defineConfig(({ command, isPreview }) => ({
  plugins: [
    tanstackStart({ spa: { enabled: true } }),
    react(),
    command === 'serve' && !isPreview && basicSsl(),
    // Start prerenders the SPA shell after all Vite environments finish.
    // Generate the precache at that point so it includes the shell and chunks.
    pwaPlugins.map((plugin) => plugin.name === 'vite-plugin-pwa:build' ? {
      ...plugin,
      enforce: 'post' as const,
      closeBundle: undefined,
      buildApp: {
        order: 'post' as const,
        async handler() { await pwaPlugins[0].api.generateSW() },
      },
    } : plugin),
  ],
  server: { host: true, port: 5173 },
}))
