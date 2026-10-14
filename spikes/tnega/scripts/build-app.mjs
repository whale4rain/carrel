import { build } from 'esbuild'
import { copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const at = (path) => fileURLToPath(new URL(path, import.meta.url))
await mkdir(at('../out'), { recursive: true })

await Promise.all([
  build({
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    // tnega loads from node_modules as published, to prove it runs in Electron's main process.
    external: ['electron', 'tnega', 'tnega/*'],
    entryPoints: [at('../app/main.ts')],
    outfile: at('../out/main.js'),
  }),
  build({
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    entryPoints: [at('../app/preload.ts')],
    outfile: at('../out/preload.cjs'),
  }),
  build({
    bundle: true,
    platform: 'browser',
    format: 'iife',
    entryPoints: [at('../app/renderer.ts')],
    outfile: at('../out/renderer.js'),
  }),
  copyFile(at('../app/index.html'), at('../out/index.html')),
])
