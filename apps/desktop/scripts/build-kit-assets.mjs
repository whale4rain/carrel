// Copies the first-party kits beside the built app, and makes Margin for kit
// pages: the tokens and the fonts (Latin subsets), served to every kit from
// its own origin at /_margin/.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = fileURLToPath(new URL('../out/', import.meta.url))
const repoKits = fileURLToPath(new URL('../../../kits/', import.meta.url))
const require = createRequire(join(fileURLToPath(new URL('../../../packages/margin/', import.meta.url)), 'package.json'))

await rm(join(out, 'kits'), { recursive: true, force: true })
await cp(repoKits, join(out, 'kits'), { recursive: true, filter: (path) => !/[\\/](test|node_modules)([\\/]|$)/.test(path) && !path.endsWith('package.json') })

const margin = join(out, 'kit-margin')
await rm(margin, { recursive: true, force: true })
await mkdir(join(margin, 'fonts'), { recursive: true })
const parts = [await readFile(join(dirname(require.resolve('@carrel/margin/tokens.css')), 'tokens.css'), 'utf8')]
const faces = [
  ['@fontsource-variable/instrument-sans', 'wght.css'],
  ['@fontsource-variable/instrument-sans', 'wght-italic.css'],
  ['@fontsource-variable/literata', 'wght.css'],
  ['@fontsource-variable/literata', 'wght-italic.css'],
  ['@fontsource-variable/jetbrains-mono', 'wght.css'],
]
for (const [family, file] of faces) {
  const folder = dirname(require.resolve(`${family}/package.json`))
  const css = await readFile(join(folder, file), 'utf8')
  // Only the Latin faces: enough for the kits' own words, and small.
  for (const face of css.split(/(?=\/\* )/)) {
    const font = /url\(\.\/files\/([^)]+\.woff2)\)/.exec(face)?.[1]
    if (!font || !/-latin(-ext)?-/.test(font)) continue
    await cp(join(folder, 'files', font), join(margin, 'fonts', font))
    parts.push(face.replace(`./files/${font}`, `fonts/${font}`).trim())
  }
}
// Quiet scrollbars, like the desk's.
parts.push('html {\n  scrollbar-width: thin;\n  scrollbar-color: var(--rule) transparent;\n}')
await writeFile(join(margin, 'margin.css'), `${parts.join('\n\n')}\n`)
