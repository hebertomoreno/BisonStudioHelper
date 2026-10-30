import { useState } from 'react'
import type { LibrarySnapshot, QueueSort, SongSummary } from '../../../shared/songs'
import { FilterBar } from '../components/FilterBar'
import { FocusStage } from '../components/FocusStage'
import { PlayButton } from '../components/Player'
import { ReorderList } from '../components/ReorderList'
import { LastWorked, Location, RootNotices, SongTags } from '../components/SongBits'
import { ExcitementPicker, StatusSelect, useSongEditor } from '../components/SongControls'
import { useLaneMover } from '../components/useLaneMover'
import { EMPTY_FILTER, isEmptyFilter, matchesFilter, type SongFilter } from '../lib/filters'
import { inManualOrder, sortQueue } from '../lib/songs'
import { LibraryHeader } from './LibraryHeader'

const SORT_LABELS: Record<QueueSort, string> = {
  lastWorked: 'Last worked',
  excitement: 'Excitement',
  manual: 'Manual'
}

export function MainListView({ snapshot }: { snapshot: LibrarySnapshot }): JSX.Element {
  const { move, dialog } = useLaneMover(snapshot)
  const editor = useSongEditor()
  const [filter, setFilter] = useState<SongFilter>(EMPTY_FILTER)
  const focus = inManualOrder(
    snapshot.songs.filter((s) => s.lane === 'focus'),
    snapshot.order.focus
  )
  const queue = sortQueue(
    snapshot.songs.filter((s) => s.lane === 'queue'),
    snapshot
  )

  const filtering = !isEmptyFilter(filter)
  const visibleQueue = queue.filter((s) => matchesFilter(s, filter))
  const reorderQueue = (ids: string[]): void => void window.finisher.reorder('queue', ids)

  return (
    <section className="view wide">
      <LibraryHeader title="Main list" snapshot={snapshot} />
      <RootNotices snapshot={snapshot} />

      <div className="lane-header">
        <h2>
          Focus <span className="muted">{focus.length} / {snapshot.focusCap}</span>
        </h2>
      </div>
      {focus.length === 0 ? (
        <p className="empty">Nothing in Focus. Move up to {snapshot.focusCap} songs here from the Queue or the Shelf.</p>
      ) : (
        <FocusStage
          songs={focus}
          snapshot={snapshot}
          onMove={move}
          onReorder={(ids) => void window.finisher.reorder('focus', ids)}
          editor={editor}
        />
      )}

      <div className="lane-header">
        <h2>
          Queue{' '}
          <span className="muted">{filtering ? `${visibleQueue.length} of ${queue.length}` : queue.length}</span>
        </h2>
        <label className="inline-field">
          Sort
          <select
            value={snapshot.queueSort}
            onChange={(e) => void window.finisher.setQueueSort(e.target.value as QueueSort)}
          >
            {(Object.keys(SORT_LABELS) as QueueSort[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <FilterBar snapshot={snapshot} filter={filter} onChange={setFilter} />
      {queue.length === 0 ? (
        <p className="empty">The Queue is empty. Bring songs in from the Shelf.</p>
      ) : visibleQueue.length === 0 ? (
        <p className="empty">No Queue songs match these filters.</p>
      ) : (
        <ReorderList
          className="queue-list"
          items={visibleQueue}
          // Reordering a filtered subset would shuffle the hidden songs; allow it only unfiltered.
          onReorder={snapshot.queueSort === 'manual' && !filtering ? reorderQueue : undefined}
          renderItem={(song, controls) => (
            <QueueRow song={song} snapshot={snapshot} controls={controls} onMove={move} editor={editor} />
          )}
        />
      )}
      {dialog}
      {editor.dialog}
    </section>
  )
}

interface RowProps {
  song: SongSummary
  snapshot: LibrarySnapshot
  controls: React.ReactNode
  onMove: ReturnType<typeof useLaneMover>['move']
  editor: ReturnType<typeof useSongEditor>
}

function QueueRow({ song, snapshot, controls, onMove, editor }: RowProps): JSX.Element {
  return (
    <div className="queue-row">
      <span className="queue-play">
        <PlayButton song={song} className="small" />
      </span>
      <span className="queue-title">{song.title}</span>
      <Location song={song} />
      <StatusSelect song={song} onChange={(status) => void editor.setStatus(song, status)} />
      <ExcitementPicker
        song={song}
        scale={snapshot.excitementScale}
        onPick={(value, note) => void editor.setExcitement(song, value, note)}
      />
      <LastWorked song={song} thresholds={snapshot.staleness} />
      <SongTags song={song} />
      <span className="row-actions">
        <button onClick={() => onMove([song.id], 'focus')}>Move to Focus</button>
        <button onClick={() => onMove([song.id], 'shelf')}>Move to Shelf</button>
        {controls}
      </span>
    </div>
  )
}
