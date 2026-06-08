import { defineConfig } from 'vite';

/** GitHub Pages 项目页：https://jk9988610.github.io/Conquer-the-Three-Kingdoms/ */
const REPO_BASE = '/Conquer-the-Three-Kingdoms/';

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? REPO_BASE : '/',
});
