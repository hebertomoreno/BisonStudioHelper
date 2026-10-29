import { useEffect, useRef, useState } from 'react'
import type { SongSummary } from '../../../shared/songs'

interface Props {
  focusSongs: SongSummary[]
  focusCap: number
  mustRemove: number
  onConfirm: (bumpToQueue: string[]) => void
  onCancel: () => void
}

// Shown when moving songs into Focus would go over the cap (SPEC section 1).
export function FocusFullDialog({ focusSongs, focusCap, mustRemove, onConfirm, onCancel }: Props): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  const [picked, setPicked] = useState<string[]>([])

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  function toggle(id: string): void {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  }

  return (
    <dialog ref={ref} className="dialog" onCancel={onCancel} aria-labelledby="focus-full-title">
      <h2 id="focus-full-title">Focus is full</h2>
      <p>
        Focus holds {focusCap} songs. Pick {mustRemove === 1 ? 'one' : mustRemove} to move to Queue.
      </p>
      <div className="dialog-list">
        {focusSongs.map((s) => (
          <label key={s.id} className="check-row">
            <input type="checkbox" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />
            {s.title}
          </label>
        ))}
      </div>
      <div className="dialog-actions">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={picked.length < mustRemove} onClick={() => onConfirm(picked)}>
          Move to Queue
        </button>
      </div>
    </dialog>
  )
}
