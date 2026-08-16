import { defineConfig } from 'vite';

/** GitHub Pages 项目页：https://jk9988610.github.io/Conquer-the-Three-Kingdoms/ */
const REPO_BASE = '/Conquer-the-Three-Kingdoms/';

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? REPO_BASE : '/',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@supabase')) return 'supabase';
          if (id.includes('/src/ui/pixelEditor') || id.includes('/src/ui/imageImport')) {
            return 'pixel-editor';
          }
          if (id.includes('/src/art/pixelGridEffects')) return 'pixel-editor';
        },
      },
    },
  },
});
