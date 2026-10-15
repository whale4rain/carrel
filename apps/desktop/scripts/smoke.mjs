// Starts the built app twice against a fresh home folder: once to create a
// project and a desk through the UI's bridge, once to check a restart comes
// back to them. Fails if either run doesn't report ok in time. Run
// `pnpm build` first.
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tinyPdf } from './tiny-pdf.mjs'

const require = createRequire(import.meta.url)
const electron = require('electron')
const appDir = fileURLToPath(new URL('..', import.meta.url))

const args = [appDir]
// Containers and CI Linux runners have no user namespace for Chromium's sandbox.
if (process.platform === 'linux') args.push('--no-sandbox')

function run(mode, home) {
  return new Promise((resolve) => {
    const child = spawn(electron, args, {
      env: { ...process.env, CARREL_SMOKE: mode, CARREL_HOME: home, CARREL_CHOOSE_FILES: join(home, 'Elasticity.pdf'), CARREL_SMOKE_PAGE: page, CARREL_LLM: 'scripted' },
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

// A web page for the desk to open, served locally so the check needs no network.
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end('<!doctype html><title>Carrel test page</title><body style="font: 32px serif; background: #fff8e0"><h1>Elasticity</h1><p>A page on the desk.</p>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const page = `http://127.0.0.1:${server.address().port}/elasticity`

const home = await mkdtemp(join(tmpdir(), 'carrel-smoke-'))
await writeFile(join(home, 'Elasticity.pdf'), tinyPdf('Price elasticity of demand'))
const ok = (await run('create', home)) && (await run('reopen', home))
server.close()
await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
if (!ok) {
  console.error('carrel smoke: failed')
  process.exit(1)
}
