import { defineConfig } from 'vite';

/** GitHub Pages 项目页：https://jk9988610.github.io/Conquer-the-Three-Kingdoms/ */
const REPO_BASE = '/Conquer-the-Three-Kingdoms/';

function viteBase(): string {
  if (process.env.CAPACITOR_BUILD === 'true') return './';
  if (process.env.GITHUB_PAGES === 'true') return REPO_BASE;
  return '/';
}

function viteOutDir(): string {
  return process.env.CAPACITOR_BUILD === 'true' ? 'www' : 'dist';
}

export default defineConfig({
  base: viteBase(),
  build: {
    outDir: viteOutDir(),
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
