import type { LibrarySnapshot, QueueSort, SongSummary } from '../../../shared/songs'
import { ReorderList } from '../components/ReorderList'
import { LastWorked, Location, RootNotices, SongTags, StatusPill } from '../components/SongBits'
import { useLaneMover } from '../components/useLaneMover'
import { inManualOrder, sortQueue } from '../lib/songs'
import { LibraryHeader } from './LibraryHeader'

const SORT_LABELS: Record<QueueSort, string> = {
  lastWorked: 'Last worked',
  excitement: 'Excitement',
  manual: 'Manual'
}

export function MainListView({ snapshot }: { snapshot: LibrarySnapshot }): JSX.Element {
  const { move, dialog } = useLaneMover(snapshot)
  const focus = inManualOrder(
    snapshot.songs.filter((s) => s.lane === 'focus'),
    snapshot.order.focus
  )
  const queue = sortQueue(
    snapshot.songs.filter((s) => s.lane === 'queue'),
    snapshot
  )

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
        <ReorderList
          className="focus-list"
          items={focus}
          onReorder={(ids) => void window.finisher.reorder('focus', ids)}
          renderItem={(song, controls) => (
            <FocusCard song={song} snapshot={snapshot} controls={controls} onMove={move} />
          )}
        />
      )}

      <div className="lane-header">
        <h2>
          Queue <span className="muted">{queue.length}</span>
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
      {queue.length === 0 ? (
        <p className="empty">The Queue is empty. Bring songs in from the Shelf.</p>
      ) : (
        <ReorderList
          className="queue-list"
          items={queue}
          onReorder={snapshot.queueSort === 'manual' ? reorderQueue : undefined}
          renderItem={(song, controls) => (
            <QueueRow song={song} snapshot={snapshot} controls={controls} onMove={move} />
          )}
        />
      )}
      {dialog}
    </section>
  )
}

interface RowProps {
  song: SongSummary
  snapshot: LibrarySnapshot
  controls: React.ReactNode
  onMove: ReturnType<typeof useLaneMover>['move']
}

function FocusCard({ song, snapshot, controls, onMove }: RowProps): JSX.Element {
  return (
    <article className="focus-card">
      <div className="focus-card-top">
        <h3>{song.title}</h3>
        {controls}
      </div>
      <div className="meta">
        <Location song={song} />
        <StatusPill song={song} />
        <LastWorked song={song} thresholds={snapshot.staleness} />
        <SongTags song={song} />
      </div>
      {song.latestNext && <p className="next-note">Next: {song.latestNext}</p>}
      <div className="row-actions">
        <button onClick={() => onMove([song.id], 'queue')}>Move to Queue</button>
        <button onClick={() => onMove([song.id], 'shelf')}>Move to Shelf</button>
      </div>
    </article>
  )
}

function QueueRow({ song, snapshot, controls, onMove }: RowProps): JSX.Element {
  return (
    <div className="queue-row">
      <span className="queue-title">{song.title}</span>
      <Location song={song} />
      <StatusPill song={song} />
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
