import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // The Axum server renders the shell from a different origin in dev.
    cors: true,
    headers: { 'Access-Control-Allow-Origin': '*' },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      input: 'src/main.tsx',
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: '[name].js',
        assetFileNames: (asset) => (asset.name?.endsWith('.css') ? 'app.css' : '[name][extname]'),
      },
    },
  },
});
