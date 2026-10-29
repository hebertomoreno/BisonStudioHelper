import { useState } from 'react'
import type { Lane, LibrarySnapshot } from '../../../shared/songs'
import { inManualOrder } from '../lib/songs'
import { FocusFullDialog } from './FocusFullDialog'

interface Pending {
  ids: string[]
  mustRemove: number
}

// Moves songs between lanes, asking which Focus songs to bump when Focus is full.
export function useLaneMover(snapshot: LibrarySnapshot): {
  move: (ids: string[], lane: Lane) => Promise<void>
  dialog: JSX.Element | null
} {
  const [pending, setPending] = useState<Pending | null>(null)

  async function move(ids: string[], lane: Lane): Promise<void> {
    const result = await window.finisher.setLane(ids, lane)
    if (!result.ok) setPending({ ids, mustRemove: result.mustRemove })
  }

  const focusSongs = inManualOrder(
    snapshot.songs.filter((s) => s.lane === 'focus'),
    snapshot.order.focus
  )

  const dialog = pending ? (
    <FocusFullDialog
      focusSongs={focusSongs}
      focusCap={snapshot.focusCap}
      mustRemove={pending.mustRemove}
      onCancel={() => setPending(null)}
      onConfirm={async (bump) => {
        setPending(null)
        await window.finisher.setLane(pending.ids, 'focus', bump)
      }}
    />
  ) : null

  return { move, dialog }
}
