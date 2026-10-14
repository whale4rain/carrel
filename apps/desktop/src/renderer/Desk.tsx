/** The grid-paper mat that sheets will sit on (milestone 2). */
export function Desk({ name }: { name: string }) {
  return (
    <main className="desk-mat" aria-label="Desk">
      <p className="desk-empty">
        <span className="desk-empty-title">{name} is empty.</span>
        Add a book, a video or a web page to start.
      </p>
    </main>
  )
}
