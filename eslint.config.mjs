import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/release/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}', 'spikes/*/app/renderer.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Kit pages run in the browser, with the host bridge as `kit`.
    files: ['kits/*/sheets/**/*.js'],
    languageOptions: { globals: { ...globals.browser, kit: 'readonly' } },
  },
)
