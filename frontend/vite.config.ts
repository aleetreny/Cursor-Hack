import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' → all built asset URLs are relative, so the same bundle works at / or behind an Ingress prefix like /app
export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1200 },
});
