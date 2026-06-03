import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    open: true,
    host: true,            // expose on the local network too
    allowedHosts: true     // accept tunnel hostnames (e.g. *.trycloudflare.com)
  }
})
