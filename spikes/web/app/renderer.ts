interface Rect { x: number; y: number; width: number; height: number }
interface SheetModel { id: string; kind: 'web' | 'note'; title: string; rect: Rect; scale: number; z: number }
interface Bridge {
  layout(layout: unknown): void
  onLive(listener: (event: { id?: string; previous?: string; reason: string }) => void): void
  onSnapshot(listener: (event: { id: string; dataUrl: string }) => void): void
}

const bridge = (window as unknown as { bridge: Bridge }).bridge
const deskElement = document.getElementById('desk') as HTMLElement
const status = document.getElementById('status') as HTMLElement

const sheets: SheetModel[] = [
  { id: 'textbook', kind: 'web', title: 'Mankiw · ch. 5', rect: { x: 40, y: 40, width: 520, height: 420 }, scale: 1, z: 1 },
  { id: 'lecture', kind: 'web', title: 'Lecture 4', rect: { x: 640, y: 60, width: 460, height: 360 }, scale: 1, z: 2 },
  { id: 'note', kind: 'note', title: 'My notes', rect: { x: 760, y: 470, width: 340, height: 220 }, scale: 1, z: 3 },
]
let activeId: string | undefined
let moving = false
let liveId: string | undefined
const elements = new Map<string, HTMLElement>()

function render(): void {
  for (const sheet of sheets) {
    let element = elements.get(sheet.id)
    if (!element) {
      element = document.createElement('div')
      element.className = 'sheet'
      element.innerHTML = `<div class="head"><span class="title"></span><span class="tag"></span><button data-scale="-">−</button><button data-scale="+">+</button></div><div class="page"></div>`
      ;(element.querySelector('.title') as HTMLElement).textContent = sheet.title
      const page = element.querySelector('.page') as HTMLElement
      if (sheet.kind === 'note') page.innerHTML = '<textarea>Elasticity: % change in quantity / % change in price.</textarea>'
      wire(element, sheet)
      deskElement.append(element)
      elements.set(sheet.id, element)
    }
    element.style.left = `${sheet.rect.x}px`
    element.style.top = `${sheet.rect.y}px`
    element.style.width = `${sheet.rect.width}px`
    element.style.height = `${sheet.rect.height}px`
    element.style.transform = `scale(${sheet.scale})`
    element.style.zIndex = String(sheet.z)
    element.classList.toggle('active', sheet.id === activeId)
    element.classList.toggle('live', sheet.id === liveId)
    const tag = element.querySelector('.tag') as HTMLElement
    tag.textContent = sheet.kind === 'note' ? `${Math.round(sheet.scale * 100)}%` : `${sheet.id === liveId ? 'live' : 'snapshot'} · ${Math.round(sheet.scale * 100)}%`
  }
}

let pending = false
function publish(): void {
  render()
  if (pending) return
  pending = true
  requestAnimationFrame(() => {
    pending = false
    const box = deskElement.getBoundingClientRect()
    bridge.layout({
      state: {
        sheets: sheets.map(({ id, kind, rect, scale, z }) => ({ id, kind, rect, scale, z })),
        activeId,
        moving,
        viewport: { x: 0, y: 0, width: box.width, height: box.height },
      },
      deskOrigin: { x: box.left, y: box.top },
    })
  })
}

function raise(sheet: SheetModel): void {
  sheet.z = Math.max(...sheets.map((entry) => entry.z)) + 1
}

function wire(element: HTMLElement, sheet: SheetModel): void {
  element.addEventListener('pointerdown', () => {
    if (activeId !== sheet.id) desk.activate(sheet.id)
  })
  for (const button of element.querySelectorAll('button')) {
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      desk.scale(sheet.id, sheet.scale + (button.dataset.scale === '+' ? 0.1 : -0.1))
    })
  }
  const head = element.querySelector('.head') as HTMLElement
  head.addEventListener('pointerdown', (event) => {
    if ((event.target as HTMLElement).tagName === 'BUTTON') return
    const start = { x: event.clientX, y: event.clientY, left: sheet.rect.x, top: sheet.rect.y }
    head.setPointerCapture(event.pointerId)
    moving = true
    publish()
    const move = (next: PointerEvent): void => {
      sheet.rect.x = start.left + next.clientX - start.x
      sheet.rect.y = start.top + next.clientY - start.y
      publish()
    }
    const up = (): void => {
      head.removeEventListener('pointermove', move)
      moving = false
      publish()
    }
    head.addEventListener('pointermove', move)
    head.addEventListener('pointerup', up, { once: true })
  })
}

bridge.onSnapshot(({ id, dataUrl }) => {
  const page = elements.get(id)?.querySelector('.page')
  if (!page) return
  let image = page.querySelector('img')
  if (!image) {
    image = document.createElement('img')
    page.append(image)
  }
  image.src = dataUrl
})

bridge.onLive(({ id, reason }) => {
  liveId = id
  const active = sheets.find((sheet) => sheet.id === activeId)
  status.innerHTML = id
    ? `<b>${active?.title ?? id}</b> is live (a real page you can scroll and click). Other web sheets show snapshots.`
    : `No live view (<b>${reason}</b>). Web sheets show snapshots.`
  render()
})

/** Used by the scripted check, and handy from DevTools. */
const desk = {
  activate(id: string): void {
    const sheet = sheets.find((entry) => entry.id === id)
    if (!sheet) return
    activeId = id
    raise(sheet)
    publish()
  },
  place(id: string, x: number, y: number): void {
    const sheet = sheets.find((entry) => entry.id === id)
    if (!sheet) return
    sheet.rect.x = x
    sheet.rect.y = y
    raise(sheet)
    // Keep the active sheet active: this is "someone dropped a sheet on it".
    publish()
  },
  scale(id: string, scale: number): void {
    const sheet = sheets.find((entry) => entry.id === id)
    if (!sheet) return
    sheet.scale = Math.round(Math.min(1, Math.max(0.3, scale)) * 10) / 10
    publish()
  },
  setMoving(value: boolean): void {
    moving = value
    publish()
  },
}
;(window as unknown as { desk: typeof desk }).desk = desk

window.addEventListener('resize', publish)
status.textContent = 'Click a web sheet to make it live. Drag sheets by their header; − and + scale them.'
publish()
