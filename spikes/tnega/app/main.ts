// The spike inside Electron: the main process owns the tnega Project, the
// window sends questions over IPC and draws the streamed answer.
import { app, BrowserWindow, ipcMain } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLlmAdapter } from 'tnega/llm'
import { CarrelTnega, type OpenCarrelProject, type StreamEvent } from '../src/carrel-project.ts'
import { searchProjectTool } from '../src/carrel-tool.ts'
import { SAMPLE_NOTES } from '../src/sample-notes.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
// Kept apart from ~/.carrel so the spike never touches real data.
const root = process.env.CARREL_SPIKE_ROOT ?? join(homedir(), '.carrel', 'spike-tnega')
const screenshot = process.env.CARREL_SPIKE_SCREENSHOT

const llm = createLlmAdapter({
  baseUrl: process.env.CARREL_LLM_BASE_URL ?? 'https://api.deepseek.com',
  model: process.env.CARREL_LLM_MODEL ?? 'deepseek-flash',
  apiKey: process.env.CARREL_LLM_API_KEY ?? '',
  protocol: 'openai',
})
const carrel = new CarrelTnega({ root, llm, tools: [searchProjectTool(SAMPLE_NOTES)] })
let project: OpenCarrelProject | undefined

async function openProject(): Promise<OpenCarrelProject> {
  if (project) return project
  await mkdir(root, { recursive: true })
  const existing = (await carrel.list()).find((record) => record.name === 'Learn economics')
  const record = existing ?? (await carrel.create('Learn economics'))
  project = await carrel.open(record.id)
  return project
}

ipcMain.handle('spike:info', async () => {
  const open = await openProject()
  const timeline = await open.box.timeline()
  return {
    project: open.record.name,
    projectId: open.record.id,
    tools: open.tools.list().map((tool) => tool.schema.name),
    notes: SAMPLE_NOTES.map((note) => note.title),
    history: timeline.map((envelope) => ({ from: envelope.sender.kind, text: envelope.text })),
  }
})

ipcMain.handle('spike:ask', async (event, text: string) => {
  const open = await openProject()
  const send = (streamEvent: StreamEvent): void => event.sender.send('spike:event', streamEvent)
  try {
    return { ok: true, text: await open.ask(text, send) }
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : String(error) }
  }
})

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 900,
    height: 720,
    title: 'Carrel · tnega spike',
    webPreferences: { preload: join(here, 'preload.cjs'), sandbox: true, contextIsolation: true },
  })
  await window.loadFile(join(here, 'index.html'))
  if (screenshot) {
    // Ask the sample question, then save what the window shows and quit.
    await window.webContents.executeJavaScript('window.spikeAsk("What did I note about price elasticity?")')
    await new Promise((resolve) => setTimeout(resolve, 500))
    const image = await window.webContents.capturePage()
    await writeFile(screenshot, image.toPNG())
    app.exit(0)
  }
}

app.whenReady().then(createWindow).catch((error: unknown) => {
  console.error(error)
  app.exit(1)
})

app.on('window-all-closed', () => {
  void project?.dispose()
  void carrel.dispose()
  app.quit()
})
