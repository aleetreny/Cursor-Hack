import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_BASE=/app/ for the workshop deployment (Ingress strips /app); default './' (relative) works anywhere.
export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  define: { __BUILD__: JSON.stringify(Date.now().toString(36)) },   // versions the service-worker cache
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // keep every JS file well under the 1 MiB ConfigMap limit
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : id.includes('node_modules') ? 'vendor' : undefined),
      },
    },
  },
});
