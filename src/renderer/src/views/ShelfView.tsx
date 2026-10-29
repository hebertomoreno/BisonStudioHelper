import { useMemo, useState } from 'react'
import type { LibrarySnapshot } from '../../../shared/songs'
import { LastWorked, Location, RootNotices, SongTags, StatusPill } from '../components/SongBits'
import { useLaneMover } from '../components/useLaneMover'
import { byLastWorked, plural } from '../lib/songs'
import { LibraryHeader } from './LibraryHeader'

type ShelfSort = 'lastWorked' | 'title'

export function ShelfView({ snapshot }: { snapshot: LibrarySnapshot }): JSX.Element {
  const { move, dialog } = useLaneMover(snapshot)
  const [query, setQuery] = useState('')
  const [rootFilter, setRootFilter] = useState<string>('all')
  const [sort, setSort] = useState<ShelfSort>('lastWorked')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const shelf = useMemo(() => {
    const q = query.trim().toLowerCase()
    return snapshot.songs
      .filter((s) => s.lane === 'shelf')
      .filter((s) => rootFilter === 'all' || s.rootPath === rootFilter)
      .filter((s) => !q || s.title.toLowerCase().includes(q) || (s.folder ?? '').toLowerCase().includes(q))
      .sort(sort === 'title' ? (a, b) => a.title.localeCompare(b.title) : byLastWorked)
  }, [snapshot.songs, query, rootFilter, sort])

  // Songs with an unreadable sidecar have no stable id and cannot change lanes.
  const movable = shelf.filter((s) => s.availability !== 'invalid-sidecar')
  const selectedVisible = movable.filter((s) => selected.has(s.id)).map((s) => s.id)
  const allSelected = movable.length > 0 && selectedVisible.length === movable.length

  function toggle(id: string): void {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function bring(lane: 'queue' | 'focus'): Promise<void> {
    await move(selectedVisible, lane)
    setSelected(new Set())
  }

  return (
    <section className="view wide">
      <LibraryHeader title="Shelf" snapshot={snapshot} />
      <RootNotices snapshot={snapshot} />

      <div className="toolbar">
        <input
          type="search"
          aria-label="Search the Shelf"
          placeholder="Search by title or folder"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select aria-label="Location" value={rootFilter} onChange={(e) => setRootFilter(e.target.value)}>
          <option value="all">All locations</option>
          {snapshot.roots.map((r) => (
            <option key={r.path} value={r.path}>
              {r.label}
            </option>
          ))}
        </select>
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as ShelfSort)}>
          <option value="lastWorked">Last worked</option>
          <option value="title">Title</option>
        </select>
      </div>

      <div className="selection-bar">
        <label className="check-row">
          <input
            type="checkbox"
            checked={allSelected}
            disabled={movable.length === 0}
            onChange={() => setSelected(allSelected ? new Set() : new Set(movable.map((s) => s.id)))}
          />
          {selectedVisible.length > 0 ? `${selectedVisible.length} selected` : plural(shelf.length, 'song')}
        </label>
        <button disabled={selectedVisible.length === 0} onClick={() => void bring('queue')}>
          Bring to queue
        </button>
        <button disabled={selectedVisible.length === 0} onClick={() => void bring('focus')}>
          Bring to focus
        </button>
      </div>

      {shelf.length === 0 ? (
        <p className="empty">
          {snapshot.songs.some((s) => s.lane === 'shelf') ? 'No songs match.' : 'The Shelf is empty.'}
        </p>
      ) : (
        <ul className="shelf-list">
          {shelf.map((song) => {
            const disabled = song.availability === 'invalid-sidecar'
            return (
              <li key={song.id} className="shelf-row">
                <input
                  type="checkbox"
                  aria-label={`Select ${song.title}`}
                  disabled={disabled}
                  checked={selected.has(song.id)}
                  onChange={() => toggle(song.id)}
                />
                <span className="queue-title">{song.title}</span>
                <Location song={song} />
                <StatusPill song={song} />
                <LastWorked song={song} />
                <SongTags song={song} />
              </li>
            )
          })}
        </ul>
      )}
      {dialog}
    </section>
  )
}
