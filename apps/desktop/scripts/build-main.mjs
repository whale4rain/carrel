import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  external: ['electron'],
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
