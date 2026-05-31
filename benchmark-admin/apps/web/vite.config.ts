import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [
    // autoCodeSplitting: each route's component lands in its own chunk so the
    // initial bundle doesn't ship every page up front.
    TanStackRouterVite({ autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
