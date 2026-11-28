import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// base './' keeps every asset path relative, so the same build works on
// GitHub Pages (/Idle-Hoard/), from a file:// folder, and inside a Tauri window.
export default defineConfig(({ mode }) => ({
  base: './',
  // `npm run build:single` inlines everything into one HTML file (handy for quick previews).
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    assetsInlineLimit: mode === 'single' ? 100_000_000 : 4096,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
}));
