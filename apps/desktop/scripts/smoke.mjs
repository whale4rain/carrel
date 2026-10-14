// Starts the built app twice against a fresh home folder: once to create a
// project and a desk through the UI's bridge, once to check a restart comes
// back to them. Fails if either run doesn't report ok in time. Run
// `pnpm build` first.
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electron = require('electron')
const appDir = fileURLToPath(new URL('..', import.meta.url))

const args = [appDir]
// Containers and CI Linux runners have no user namespace for Chromium's sandbox.
if (process.platform === 'linux') args.push('--no-sandbox')

function run(mode, home) {
  return new Promise((resolve) => {
    const child = spawn(electron, args, {
      env: { ...process.env, CARREL_SMOKE: mode, CARREL_HOME: home },
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
      process.stdout.write(`[${mode}] ${chunk}`)
    })
    const timer = setTimeout(() => {
      console.error(`carrel smoke: ${mode} timed out`)
      child.kill()
      resolve(false)
    }, 60_000)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve(code === 0 && output.includes('carrel smoke: ok'))
    })
  })
}

const home = await mkdtemp(join(tmpdir(), 'carrel-smoke-'))
const ok = (await run('create', home)) && (await run('reopen', home))
await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
if (!ok) {
  console.error('carrel smoke: failed')
  process.exit(1)
}
