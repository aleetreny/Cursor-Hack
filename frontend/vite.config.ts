import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base ('./'): the site works under any path, e.g. GitHub Pages /<repo>/. VITE_BASE overrides it.
export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  define: { __BUILD__: JSON.stringify(Date.now().toString(36)) },   // versions the service-worker cache
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      // two pages: the app and the methods-and-sources page
      input: { main: 'index.html', methods: 'methods.html' },
      output: {
        // the in-browser AI libraries stay in their own chunks, fetched only when a visitor turns them on
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three'
          : /node_modules\/(@huggingface|onnxruntime)/.test(id) ? undefined
          : id.includes('node_modules') ? 'vendor' : undefined),
      },
    },
  },
});
