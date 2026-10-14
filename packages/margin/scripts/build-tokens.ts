import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { generateCss, generateModule, type TokensJson } from '../src/generate.ts'

const at = (path: string): string => fileURLToPath(new URL(path, import.meta.url))
export const TOKENS_JSON = at('../../../.agent/design/margin/tokens.json')

const json = JSON.parse(await readFile(TOKENS_JSON, 'utf8')) as TokensJson
await writeFile(at('../src/generated/tokens.css'), generateCss(json))
await writeFile(at('../src/generated/tokens.ts'), generateModule(json))
console.log('Margin tokens regenerated from .agent/design/margin/tokens.json')
