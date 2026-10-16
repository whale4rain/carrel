import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  // pdf.js loads its worker and fonts beside itself, and tnega is used as published, so both stay packages.
  external: ['electron', 'pdfjs-dist', 'tnega'],
}

await Promise.all([
  build({
    ...shared,
    format: 'esm',
    // Lets bundled CommonJS dependencies call require() from ESM output.
    banner: {
      js: "import { createRequire as __carrelCreateRequire } from 'node:module'; const require = __carrelCreateRequire(import.meta.url);",
    },
    entryPoints: [fileURLToPath(new URL('../src/main/main.ts', import.meta.url))],
    outfile: fileURLToPath(new URL('../out/main.js', import.meta.url)),
  }),
  build({
    ...shared,
    // Sandboxed preloads run as CommonJS.
    format: 'cjs',
    entryPoints: [fileURLToPath(new URL('../src/main/preload.ts', import.meta.url))],
    outfile: fileURLToPath(new URL('../out/preload.cjs', import.meta.url)),
  }),
])

await import('./build-kit-assets.mjs')
