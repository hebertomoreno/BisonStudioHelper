import { useState } from 'react'
import type { LibrarySnapshot } from '../../../shared/songs'
import { plural } from '../lib/songs'

export function LibraryHeader({ title, snapshot }: { title: string; snapshot: LibrarySnapshot }): JSX.Element {
  const [showWarnings, setShowWarnings] = useState(false)

  return (
    <>
      <header className="view-header">
        <h1>{title}</h1>
        <div className="actions">
          {snapshot.warnings.length > 0 && (
            <button className="link-button" onClick={() => setShowWarnings((v) => !v)}>
              {plural(snapshot.warnings.length, 'scan warning')}
            </button>
          )}
          <span className="muted" aria-live="polite">
            {snapshot.scanning ? 'Scanning…' : ''}
          </span>
          <button disabled={snapshot.scanning} onClick={() => void window.finisher.rescan()}>
            Rescan
          </button>
        </div>
      </header>
      {showWarnings && (
        <div className="notice warning">
          <ul>
            {snapshot.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
