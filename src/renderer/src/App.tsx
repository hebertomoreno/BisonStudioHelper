import { useState } from 'react'
import { Placeholder } from './views/Placeholder'
import { SettingsView } from './views/SettingsView'

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
  const [view, setView] = useState<ViewId>('settings')
  const current = VIEWS.find((v) => v.id === view)!

  return (
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
          </button>
        ))}
      </nav>
      <main className="content">
        {view === 'settings' ? (
          <SettingsView />
        ) : (
          <Placeholder title={current.label} step={current.step} />
        )}
      </main>
    </div>
  )
}
