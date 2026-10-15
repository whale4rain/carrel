// Draws the app icon files from the SVG sources in build/, using Electron's
// own renderer so no image tools are needed:
//   build/icon.svg      → build/icon.png (512) and build/icon.ico (Windows)
//   build/icon-mac.svg  → build/icon.icns and build/icon-mac.png (Mac, on Apple's 1024 grid)
// Run with: pnpm --filter @carrel/desktop icons
import { app, BrowserWindow } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('../build/', import.meta.url))
const MASTER = 1024

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.disableHardwareAcceleration()
// Each drawing closes its window; that must not end the run.
app.on('window-all-closed', () => undefined)

/** The SVG drawn at 1024×1024 on a transparent ground, as a nativeImage. */
async function render(file) {
  const svg = await readFile(dir + file, 'utf8')
  const page = `<!doctype html><style>html,body{margin:0;background:transparent}img{display:block}</style>
    <img width="${MASTER}" height="${MASTER}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`
  const window = new BrowserWindow({
    width: MASTER,
    height: MASTER,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  })
  await window.loadURL(`data:text/html;base64,${Buffer.from(page).toString('base64')}`)
  await window.webContents.executeJavaScript('document.querySelector("img").decode()')
  const image = await window.webContents.capturePage({ x: 0, y: 0, width: MASTER, height: MASTER })
  window.destroy()
  return image
}

const png = (image, size) => (size === MASTER ? image : image.resize({ width: size, height: size, quality: 'best' })).toPNG()

/** An .ico holding PNG images (Windows Vista and later read these). */
function ico(image, sizes) {
  const images = sizes.map((size) => png(image, size))
  const header = Buffer.alloc(6 + 16 * sizes.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  sizes.forEach((size, i) => {
    const entry = 6 + 16 * i
    header.writeUInt8(size >= 256 ? 0 : size, entry)
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(images[i].length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += images[i].length
  })
  return Buffer.concat([header, ...images])
}

/** An .icns holding PNG images, one per Apple icon type. */
function icns(image) {
  const types = [
    ['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
    ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512],
  ]
  const chunks = types.map(([type, size]) => {
    const data = png(image, size)
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([head, data])
  })
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4)
  return Buffer.concat([head, ...chunks])
}

app.whenReady().then(async () => {
  const plain = await render('icon.svg')
  await writeFile(dir + 'icon.png', png(plain, 512))
  await writeFile(dir + 'icon.ico', ico(plain, [16, 24, 32, 48, 64, 128, 256]))
  const mac = await render('icon-mac.svg')
  await writeFile(dir + 'icon.icns', icns(mac))
  await writeFile(dir + 'icon-mac.png', png(mac, 512))
  console.log('Wrote build/icon.png, icon.ico, icon.icns and icon-mac.png')
  app.quit()
}, (error) => {
  console.error(error)
  app.exit(1)
})
