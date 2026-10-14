// Try the spike against a real model:
//
//   CARREL_LLM_API_KEY=sk-... pnpm --filter @carrel/spike-tnega demo "What did I note about elasticity?"
//
// Defaults to DeepSeek's OpenAI-compatible API; set CARREL_LLM_BASE_URL and
// CARREL_LLM_MODEL for another route. State goes to a temporary folder.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLlmAdapter } from 'tnega/llm'
import { CarrelTnega } from './carrel-project.ts'
import { searchProjectTool } from './carrel-tool.ts'
import { SAMPLE_NOTES } from './sample-notes.ts'

const question = process.argv.slice(2).join(' ') || 'What did I note about price elasticity, and which note says it?'
const llm = createLlmAdapter({
  baseUrl: process.env.CARREL_LLM_BASE_URL ?? 'https://api.deepseek.com',
  model: process.env.CARREL_LLM_MODEL ?? 'deepseek-flash',
  apiKey: process.env.CARREL_LLM_API_KEY ?? 'injected-by-proxy',
  protocol: 'openai',
})

const root = await mkdtemp(join(tmpdir(), 'carrel-spike-'))
const carrel = new CarrelTnega({ root, llm, tools: [searchProjectTool(SAMPLE_NOTES)] })
try {
  const record = await carrel.create('Learn economics')
  console.log(`Created tnega Project "${record.name}" (${record.id})`)
  const project = await carrel.open(record.id)
  console.log(`You: ${question}\n`)
  let streamed = false
  const started = Date.now()
  let firstChunkMs: number | undefined
  let chunks = 0
  await project.ask(question, (event) => {
    if (event.type === 'chunk') {
      firstChunkMs ??= Date.now() - started
      streamed = true
      chunks += 1
      process.stdout.write(event.text)
    } else if (event.type === 'tool-call') {
      process.stdout.write(`\n▸ ${event.name} ${JSON.stringify(event.arguments)}\n`)
    } else if (event.type === 'reply') {
      if (!streamed) process.stdout.write(event.text)
      process.stdout.write('\n')
    }
  })
  console.log(`\n(${chunks} streamed chunks; first after ${firstChunkMs ?? '?'} ms, done after ${Date.now() - started} ms)`)
  await project.dispose()
} finally {
  await carrel.dispose()
  await rm(root, { recursive: true, force: true })
}
