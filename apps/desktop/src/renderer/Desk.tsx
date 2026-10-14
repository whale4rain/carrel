import { NameField } from './NameField.js'

/** The desk area before there is any project. */
export function Welcome({ onCreate }: { onCreate(name: string): Promise<void> }) {
  return (
    <main className="desk-mat" aria-label="Desk">
      <section className="welcome">
        <h2 className="welcome-title">Start a project</h2>
        <p className="welcome-body">
          A project holds the books, videos, notes and desks for one thing you're learning. It's a folder in{' '}
          <code>~/Carrel</code>, so your notes stay yours.
        </p>
        <NameField variant="form" label="Project name" placeholder="Learn economics" submit="Create project" onSubmit={onCreate} />
      </section>
    </main>
  )
}
