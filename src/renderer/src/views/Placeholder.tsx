export function Placeholder({ title, step }: { title: string; step: string }): JSX.Element {
  return (
    <section className="view">
      <header className="view-header">
        <h1>{title}</h1>
      </header>
      <p className="muted">Not built yet. Arrives in build step {step}.</p>
    </section>
  )
}
