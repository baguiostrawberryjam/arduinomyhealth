import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The production build is served by Express from web/dist, so the app always
// calls relative /api paths and never a hardcoded host. In dev, proxy those
// paths to the Express server so the same relative URLs work there too.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
