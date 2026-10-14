import { themes } from '@carrel/margin'

// Placeholder until the Electron shell (milestone 1, task 3) draws the desk.
export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 48 }}>
      <h1 style={{ fontWeight: 500 }}>Carrel</h1>
      <p>Scaffold is running. Themes ready: {themes.join(', ')}.</p>
    </main>
  )
}
