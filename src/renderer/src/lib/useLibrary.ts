import { useEffect, useState } from 'react'
import type { LibrarySnapshot } from '../../../shared/songs'

// The current song library, kept up to date by pushes from main.
export function useLibrary(): LibrarySnapshot | null {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null)

  useEffect(() => {
    let active = true
    const unsubscribe = window.finisher.onLibraryChanged((next) => setSnapshot(next))
    window.finisher.getLibrary().then((initial) => {
      // A push may have arrived first; keep whichever is newer by not overwriting it.
      if (active) setSnapshot((current) => current ?? initial)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return snapshot
}
