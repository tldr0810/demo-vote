import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'

export default defineConfig({
  server: {
    // 5173 is taken by other projects in this workspace.
    port: 5273,
    strictPort: true,
    // Listen on the LAN, not just loopback, so the whole flow can be tested the
    // way it will actually be used: scanning a QR code from a phone.
    host: true,
  },
  plugins: [react(), cloudflare()],
})
