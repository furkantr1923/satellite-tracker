import { defineConfig } from 'vite';

// Göreli taban yolu: Tauri (Windows) ve Capacitor (Android) paketlerinde dosyalar yerelden sunulur.
export default defineConfig({
  base: './',
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  worker: { format: 'es' },
  build: {
    target: ['es2022', 'chrome100', 'edge100', 'safari15'],
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
    sourcemap: false,
  },
});
