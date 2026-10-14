// Starts the built app with CARREL_SMOKE=1 and fails if it doesn't report a
// rendered page in time. Run `pnpm build` first.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electron = require('electron')
const appDir = fileURLToPath(new URL('..', import.meta.url))

const args = [appDir]
// Containers and CI Linux runners have no user namespace for Chromium's sandbox.
if (process.platform === 'linux') args.push('--no-sandbox')

const child = spawn(electron, args, {
  env: { ...process.env, CARREL_SMOKE: '1' },
  stdio: ['ignore', 'pipe', 'inherit'],
})

let output = ''
child.stdout.on('data', (chunk) => {
  output += chunk
  process.stdout.write(chunk)
})

const timer = setTimeout(() => {
  console.error('carrel smoke: timed out')
  child.kill()
  process.exit(1)
}, 60_000)

child.on('exit', (code) => {
  clearTimeout(timer)
  if (code === 0 && output.includes('carrel smoke: ok')) process.exit(0)
  console.error(`carrel smoke: failed (exit ${code})`)
  process.exit(1)
})
