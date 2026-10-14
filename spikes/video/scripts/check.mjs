// Runs the scripted check in the built app. Set CARREL_SPIKE_YOUTUBE to a
// video id or link to include YouTube (needs the network).
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electron = require('electron')
const args = [fileURLToPath(new URL('..', import.meta.url))]
if (process.platform === 'linux') args.push('--no-sandbox')

const child = spawn(electron, args, { env: { ...process.env, CARREL_SPIKE_CHECK: '1' }, stdio: 'inherit' })
const timer = setTimeout(() => {
  console.error('spike check: timed out')
  child.kill()
  process.exit(1)
}, 120_000)
child.on('exit', (code) => {
  clearTimeout(timer)
  process.exit(code ?? 1)
})
