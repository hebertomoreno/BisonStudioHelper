import { useState } from 'react'
import { STATUSES, type Status } from '../../../shared/sidecar'
import type { LibrarySnapshot, SongSummary } from '../../../shared/songs'
import { FilterBar } from '../components/FilterBar'
import { PlayButton } from '../components/Player'
import { LastWorked, Location, RootNotices, Sessions, SongTags } from '../components/SongBits'
import { ExcitementPicker, StatusSelect, useSongEditor } from '../components/SongControls'
import { EMPTY_FILTER, matchesFilter, type SongFilter } from '../lib/filters'
import { byLastWorked } from '../lib/songs'
import { LibraryHeader } from './LibraryHeader'

const LANE_LABEL = { focus: 'Focus', queue: 'Queue', shelf: 'Shelf' } as const

// Status columns (SPEC 8). Dragging a card to another column changes its status; the status menu
// on each card does the same from the keyboard.
export function BoardView({ snapshot }: { snapshot: LibrarySnapshot }): JSX.Element {
  const editor = useSongEditor()
  const [includeShelf, setIncludeShelf] = useState(false)
  const [filter, setFilter] = useState<SongFilter>(EMPTY_FILTER)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overColumn, setOverColumn] = useState<Status | null>(null)

  const songs = snapshot.songs
    .filter((s) => includeShelf || s.lane !== 'shelf')
    .filter((s) => matchesFilter(s, filter))
    .sort((a, b) => laneRank(a) - laneRank(b) || byLastWorked(a, b))

  function drop(status: Status): void {
    const song = songs.find((s) => s.id === dragId)
    setDragId(null)
    setOverColumn(null)
    if (song && song.status !== status) void editor.setStatus(song, status)
  }

  return (
    <section className="view board-view">
      <LibraryHeader title="Board" snapshot={snapshot} />
      <RootNotices snapshot={snapshot} />
      <div className="toolbar">
        <label className="check-row">
          <input type="checkbox" checked={includeShelf} onChange={(e) => setIncludeShelf(e.target.checked)} />
          Include Shelf
        </label>
      </div>
      <FilterBar snapshot={snapshot} filter={filter} onChange={setFilter} />

      <div className="board">
        {STATUSES.map((status) => {
          const column = songs.filter((s) => s.status === status)
          return (
            <section
              key={status}
              className={`board-column ${overColumn === status ? 'drop-target' : ''}`}
              aria-label={`${status}, ${column.length} songs`}
              onDragOver={(e) => {
                if (!dragId) return
                e.preventDefault()
                setOverColumn(status)
              }}
              onDragLeave={() => setOverColumn((c) => (c === status ? null : c))}
              onDrop={(e) => {
                e.preventDefault()
                drop(status)
              }}
            >
              <h2 className="board-column-title">
                <span className={`status-dot status-${status.replace(' ', '-')}`} />
                {status} <span className="muted">{column.length}</span>
              </h2>
              <ul>
                {column.map((song) => (
                  <li
                    key={song.id}
                    draggable={song.availability === 'ok'}
                    className={dragId === song.id ? 'dragging' : ''}
                    onDragStart={(e) => {
                      setDragId(song.id)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragEnd={() => {
                      setDragId(null)
                      setOverColumn(null)
                    }}
                  >
                    <BoardCard song={song} snapshot={snapshot} editor={editor} />
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
      {editor.dialog}
    </section>
  )
}

function laneRank(song: SongSummary): number {
  return song.lane === 'focus' ? 0 : song.lane === 'queue' ? 1 : 2
}

function BoardCard({
  song,
  snapshot,
  editor
}: {
  song: SongSummary
  snapshot: LibrarySnapshot
  editor: ReturnType<typeof useSongEditor>
}): JSX.Element {
  return (
    <article className={`board-card lane-${song.lane}`}>
      <div className="board-card-top">
        <span className="board-title">{song.title}</span>
        <PlayButton song={song} className="small" />
      </div>
      <div className="board-meta">
        <span className={`lane-tag lane-tag-${song.lane}`}>{LANE_LABEL[song.lane]}</span>
        <Location song={song} />
      </div>
      <div className="board-meta">
        <StatusSelect song={song} onChange={(status) => void editor.setStatus(song, status)} />
        <ExcitementPicker
          song={song}
          scale={snapshot.excitementScale}
          onPick={(value, note) => void editor.setExcitement(song, value, note)}
        />
        <LastWorked song={song} thresholds={snapshot.staleness} />
      </div>
      <Sessions song={song} />
      <SongTags song={song} />
    </article>
  )
}
