import { useState } from 'react'
import type { SongSummary } from '../../../shared/songs'
import { errorText } from './Cover'

// The song's name, renamed in place. Only the sidecar title changes; folders and .als files don't.
export function EditableTitle({ song }: { song: SongSummary }): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canRename = song.availability === 'ok'

  async function save(): Promise<void> {
    if (draft === null) return
    const next = draft.trim()
    setDraft(null)
    if (!next || next === song.title) return
    try {
      setError(null)
      await window.finisher.setTitle(song.id, next)
    } catch (err) {
      setError(errorText(err))
    }
  }

  if (draft !== null) {
    return (
      <input
        className="title-input"
        aria-label="Song title"
        autoFocus
        value={draft}
        maxLength={200}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save()
          if (e.key === 'Escape') setDraft(null)
        }}
      />
    )
  }

  return (
    <>
      <h3 className="song-title">
        {canRename ? (
          <button className="title-button" title="Rename" onClick={() => setDraft(song.title)}>
            {song.title}
          </button>
        ) : (
          song.title
        )}
      </h3>
      {error && (
        <p className="cover-error" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
