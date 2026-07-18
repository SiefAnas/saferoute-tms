import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Explicit dual-stack bind: Vite's default "localhost" host resolved to the IPv6
    // loopback (::1) ONLY on this machine, so http://127.0.0.1:5173 from a normal browser
    // got connection-refused even though the server was "running" and reachable via ::1.
    // '::' matches how the API server (no host arg -> Node's dual-stack default) already
    // binds — confirmed reachable via BOTH 127.0.0.1:4000 and ::1:4000 on this machine.
    host: '::',
    port: 5173,
    strictPort: true,
    proxy: {
      // Frontend calls /api/*; forwarded to the Express API with /api stripped,
      // so the (already tested) backend routes need no path changes.
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
