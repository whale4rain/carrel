interface SpikeEvent {
  type: 'chunk' | 'tool-call' | 'tool-result' | 'reply'
  text?: string
  name?: string
  arguments?: unknown
}

interface SpikeApi {
  info(): Promise<{ project: string; projectId: string; tools: string[]; notes: string[]; history: Array<{ from: string; text: string }> }>
  ask(text: string): Promise<{ ok: boolean; text: string }>
  onEvent(listener: (event: SpikeEvent) => void): void
}

const api = (window as unknown as { spike: SpikeApi }).spike
const log = document.getElementById('log') as HTMLElement
const form = document.getElementById('form') as HTMLFormElement
const input = document.getElementById('input') as HTMLInputElement
let current: HTMLElement | undefined

function line(className: string, text: string): HTMLElement {
  const element = document.createElement('p')
  element.className = `turn ${className}`
  element.textContent = text
  log.append(element)
  return element
}

api.onEvent((event) => {
  if (event.type === 'tool-call') {
    line('step', `▸ ${event.name ?? 'tool'} ${JSON.stringify(event.arguments)}`)
    current = undefined
  } else if (event.type === 'chunk') {
    current ??= line('agent', '')
    current.textContent += event.text ?? ''
  }
})

async function ask(text: string): Promise<void> {
  line('user', text)
  current = undefined
  const result = await api.ask(text)
  if (!result.ok) line('error', `Failed: ${result.text}`)
  else if (!current) line('agent', result.text)
  current = undefined
}

;(window as unknown as { spikeAsk: (text: string) => Promise<void> }).spikeAsk = ask

form.addEventListener('submit', (event) => {
  event.preventDefault()
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  void ask(text)
})

void api.info().then((info) => {
  ;(document.getElementById('meta') as HTMLElement).textContent =
    `tnega Project "${info.project}" · tools: ${info.tools.join(', ')} · sample notes: ${info.notes.join(', ')}`
  for (const entry of info.history) line(entry.from === 'user' ? 'user' : 'agent', entry.text)
})
