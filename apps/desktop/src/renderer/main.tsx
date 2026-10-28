import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { KeepWindow } from './KeepWindow.js'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    {new URLSearchParams(location.search).has('keep') ? <KeepWindow /> : <App />}
  </StrictMode>,
)
