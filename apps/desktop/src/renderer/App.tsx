import { themes, tokens, type ColorToken, type Theme, type TypeStyle } from '@carrel/margin'
import './app.css'

// A token sheet until the Electron shell (milestone 1, task 3) draws the desk:
// every Margin color and type style, in Day and Night side by side.
const colors = Object.keys(tokens.colors) as ColorToken[]
const typeStyles = Object.keys(tokens.typeStyles) as TypeStyle[]

const samples: Record<TypeStyle, string> = {
  display: 'Carrel',
  title: 'Supply and demand',
  heading: 'Lecture 4 · Elasticity',
  body: 'Your own writing, upright in ink.',
  label: 'Focus  Compare  Make a pile',
  caption: 'Added 14 Oct · 3 notes cite this',
  reading: 'A market is a group of buyers and sellers of a particular good.',
  marginalia: 'This is the same idea as the 1890 Marshall diagram.',
  position: 'p. 67 · 12:04',
}

function ThemePanel({ theme }: { theme: Theme }) {
  return (
    <section className="panel" data-theme={theme} aria-label={`${theme} theme`}>
      <div className="sheet">
        <p className="caption">{theme === 'day' ? 'Day' : 'Night'}</p>
        <div className="type">
          {typeStyles.map((style) => (
            <div key={style} className="type-row">
              <span className="position">{style}</span>
              <span className={`sample-${style}`} style={{ font: `var(--text-${style})`, letterSpacing: `var(--text-${style}-tracking, normal)` }}>
                {style === 'reading' ? (
                  <>
                    A market is a group of <mark>buyers and sellers</mark> of a particular good.
                  </>
                ) : (
                  samples[style]
                )}
              </span>
            </div>
          ))}
        </div>
        <ul className="swatches">
          {colors.map((name) => (
            <li key={name}>
              <span className="chip" style={{ background: `var(--${name})` }} />
              <span className="label">{name}</span>
              <span className="position">{tokens.colors[name][theme]}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export function App() {
  return (
    <main className="tokens">
      <h1 className="title">Carrel</h1>
      <p className="body">Margin tokens, generated from tokens.json.</p>
      <div className="panels">
        {themes.map((theme) => (
          <ThemePanel key={theme} theme={theme} />
        ))}
      </div>
    </main>
  )
}
