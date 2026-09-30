import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: {
    // hls.js (~600 kB, needed for playback and captions) is the one big file, loaded only on video pages.
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        // Libraries change rarely, so they get their own long-cached files; the video player
        // library loads only with the watch page.
        manualChunks(id) {
          if (id.includes('node_modules/hls.js')) return 'hls';
          if (
            /node_modules\/(react|react-dom|react-router|react-router-dom|scheduler|@remix-run)\//.test(id)
          ) {
            return 'react';
          }
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
  },
});
