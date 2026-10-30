import { useEffect, useRef, useState } from 'react'
import { STATUSES, type Status } from '../../../shared/sidecar'
import type { LibrarySnapshot, SongSummary } from '../../../shared/songs'
import { errorText } from './Cover'

type Scale = LibrarySnapshot['excitementScale']

const READ_ONLY = "The song's drive isn't connected, so it can't be changed now"

// Changes status and excitement, with the follow-ups they need: setting a Focus song to finished
// asks whether to move it out of Focus (SPEC 8). Render `dialog` once per view.
export function useSongEditor(): {
  setStatus: (song: SongSummary, status: Status) => Promise<void>
  setExcitement: (song: SongSummary, value: number, note?: string) => Promise<void>
  dialog: JSX.Element | null
} {
  const [finished, setFinished] = useState<SongSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => setError(null), 5000)
    return () => window.clearTimeout(timer)
  }, [error])

  async function run(action: () => Promise<void>): Promise<boolean> {
    try {
      await action()
      return true
    } catch (err) {
      setError(errorText(err))
      return false
    }
  }

  async function setStatus(song: SongSummary, status: Status): Promise<void> {
    const ok = await run(() => window.finisher.setStatus(song.id, status))
    if (ok && status === 'finished' && song.lane === 'focus') setFinished(song)
  }

  async function setExcitement(song: SongSummary, value: number, note?: string): Promise<void> {
    await run(() => window.finisher.setExcitement(song.id, value, note ?? null))
  }

  const dialog = (
    <>
      {finished && (
        <FinishedDialog
          song={finished}
          onDone={async (lane) => {
            setFinished(null)
            if (lane) await run(async () => void (await window.finisher.setLane([finished.id], lane)))
          }}
        />
      )}
      {error && (
        <div className="toast" role="alert">
          {error}
        </div>
      )}
    </>
  )
  return { setStatus, setExcitement, dialog }
}

function FinishedDialog({
  song,
  onDone
}: {
  song: SongSummary
  onDone: (lane: 'queue' | 'shelf' | null) => void
}): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog ref={ref} className="dialog" onCancel={() => onDone(null)} aria-labelledby="finished-title">
      <h2 id="finished-title">{song.title} is finished</h2>
      <p>Move it out of Focus to make room for the next one?</p>
      <div className="dialog-actions">
        <button onClick={() => onDone(null)}>Keep in Focus</button>
        <button onClick={() => onDone('shelf')}>Move to Shelf</button>
        <button className="primary" onClick={() => onDone('queue')}>
          Move to Queue
        </button>
      </div>
    </dialog>
  )
}

// The status as a pill that opens the five statuses (SPEC 8).
export function StatusSelect({
  song,
  onChange
}: {
  song: SongSummary
  onChange: (status: Status) => void
}): JSX.Element {
  const editable = song.availability === 'ok'
  return (
    <select
      className={`status status-select status-${(song.status ?? 'idea').replace(' ', '-')}`}
      aria-label={`Status of ${song.title}`}
      title={editable ? 'Change status' : READ_ONLY}
      disabled={!editable}
      value={song.status ?? ''}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value as Status)}
    >
      {!song.status && <option value="">unknown</option>}
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  )
}

// The excitement emoji; click to pick 1–5 with an optional note (SPEC 8a).
export function ExcitementPicker({
  song,
  scale,
  onPick
}: {
  song: SongSummary
  scale: Scale
  onPick: (value: number, note?: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const ref = useRef<HTMLSpanElement>(null)
  const current = scale.find((l) => l.value === song.excitement)
  const editable = song.availability === 'ok'

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <span className="excitement" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        className={current ? 'excitement-button' : 'excitement-button unrated'}
        aria-label={current ? `Excitement: ${current.label}. Change` : `Rate ${song.title}`}
        aria-expanded={open}
        title={editable ? (current?.label ?? 'Not rated yet') : READ_ONLY}
        disabled={!editable}
        onClick={() => {
          setNote('')
          setOpen((o) => !o)
        }}
      >
        {current ? current.emoji : 'Rate'}
      </button>
      {open && (
        <div
          className="excitement-popover"
          role="dialog"
          aria-label="How excited are you about this song?"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
          }}
        >
          <div className="excitement-options">
            {scale.map((level) => (
              <button
                key={level.value}
                className={level.value === song.excitement ? 'selected' : ''}
                title={`${level.value} · ${level.label}`}
                aria-label={`${level.value}: ${level.label}`}
                onClick={() => {
                  setOpen(false)
                  onPick(level.value, note)
                }}
              >
                {level.emoji}
              </button>
            ))}
          </div>
          <input
            aria-label="Note (optional)"
            placeholder="Why? (optional)"
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      )}
    </span>
  )
}
