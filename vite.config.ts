import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'

// HTTPS is mandatory on a phone: camera (getUserMedia) and the motion sensors
// both require a secure context. basicSsl gives a self-signed cert for LAN testing.
export default defineConfig({
  plugins: [
    react(),
    basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
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
    }),
  ],
  server: { host: true, port: 5173 },
})
