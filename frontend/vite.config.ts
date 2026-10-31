import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Listen on all interfaces so teammates can reach http://100.117.73.55:5173 over Tailscale.
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
})
