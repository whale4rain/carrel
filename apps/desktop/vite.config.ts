import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Builds the renderer into out/renderer; the main process is bundled
// separately by scripts/build-main.mjs.
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../../out/renderer',
    emptyOutDir: true,
    // Keep fonts as files: the page's CSP doesn't allow data: URLs.
    assetsInlineLimit: 0,
  },
})
