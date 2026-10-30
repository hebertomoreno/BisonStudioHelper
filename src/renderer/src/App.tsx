import { useState } from 'react'
import { PlayerBar, PlayerProvider } from './components/Player'
import { useLibrary } from './lib/useLibrary'
import { BoardView } from './views/BoardView'
import { MainListView } from './views/MainListView'
import { Placeholder } from './views/Placeholder'
import { SettingsView } from './views/SettingsView'
import { ShelfView } from './views/ShelfView'

type ViewId = 'main' | 'board' | 'shelf' | 'releases' | 'inbox' | 'settings'

// SPEC section 9. `step` is the build-order step (section 10) that delivers each view.
const VIEWS: { id: ViewId; label: string; step: string }[] = [
  { id: 'main', label: 'Main list', step: '2' },
  { id: 'board', label: 'Board', step: '5' },
  { id: 'shelf', label: 'Shelf', step: '2' },
  { id: 'releases', label: 'Releases', step: '6a' },
  { id: 'inbox', label: 'Inbox', step: '4b' },
  { id: 'settings', label: 'Settings', step: '1' }
]

export function App(): JSX.Element {
  const [view, setView] = useState<ViewId>('main')
  const library = useLibrary()
  const current = VIEWS.find((v) => v.id === view)!
  const shelfCount = library?.songs.filter((s) => s.lane === 'shelf').length ?? 0

  function render(): JSX.Element {
    if (view === 'settings') return <SettingsView />
    if (!library) {
      return (
        <section className="view">
          <p className="muted">Loading songs…</p>
        </section>
      )
    }
    if (view === 'main') return <MainListView snapshot={library} />
    if (view === 'shelf') return <ShelfView snapshot={library} />
    if (view === 'board') return <BoardView snapshot={library} />
    return <Placeholder title={current.label} step={current.step} />
  }

  return (
    <PlayerProvider>
      <div className="app">
        <nav className="sidebar" aria-label="Views">
          <div className="brand">Finisher</div>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={v.id === view ? 'nav-item active' : 'nav-item'}
              aria-current={v.id === view ? 'page' : undefined}
              onClick={() => setView(v.id)}
            >
              {v.label}
              {v.id === 'shelf' && shelfCount > 0 && <span className="count">{shelfCount}</span>}
            </button>
          ))}
        </nav>
        <main className="content">{render()}</main>
        <PlayerBar />
      </div>
    </PlayerProvider>
  )
}
