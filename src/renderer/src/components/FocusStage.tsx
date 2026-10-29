import { useState } from 'react'
import { STATUSES, type Status } from '../../../shared/sidecar'
import type { LibrarySnapshot, SongSummary } from '../../../shared/songs'
import { Cover } from './Cover'
import { EditableTitle } from './EditableTitle'
import { percent, ProgressBar } from './ProgressBar'
import { Bounced, LastWorked, Location, SongTags, StatusPill } from './SongBits'
import type { useLaneMover } from './useLaneMover'

const SIDE_OFFSET_PX = 230

interface Props {
  songs: SongSummary[]
  snapshot: LibrarySnapshot
  onMove: ReturnType<typeof useLaneMover>['move']
  onReorder: (ids: string[]) => void
}

// Focus songs as CD cases on a stage: the selected one large in the middle, its neighbors
// smaller on either side. Click a neighbor or use ← → to bring it to the middle.
export function FocusStage({ songs, snapshot, onMove, onReorder }: Props): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const found = songs.findIndex((s) => s.id === selectedId)
  const index = found === -1 ? 0 : found
  const selected = songs[index]
  const release = selected?.releases[0]
  const releaseProgress = release ? snapshot.releases.find((r) => r.id === release.id)?.progress : undefined
  const wrap = songs.length >= 3

  // Position of each song relative to the selected one: 0 = middle, ±1 = sides, else hidden.
  function offsetOf(i: number): number {
    let off = i - index
    if (wrap) {
      if (off > songs.length / 2) off -= songs.length
      if (off < -songs.length / 2) off += songs.length
    }
    return off
  }

  function select(i: number): void {
    const n = songs.length
    setSelectedId(songs[wrap ? (i + n) % n : Math.max(0, Math.min(n - 1, i))].id)
  }

  function shift(by: -1 | 1): void {
    const ids = songs.map((s) => s.id)
    const to = index + by
    if (to < 0 || to >= ids.length) return
    ;[ids[index], ids[to]] = [ids[to], ids[index]]
    onReorder(ids)
  }

  return (
    <section
      className="focus-stage"
      tabIndex={0}
      aria-roledescription="carousel"
      aria-label="Focus songs"
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest('input, select')) return
        if (e.key === 'ArrowLeft') select(index - 1)
        if (e.key === 'ArrowRight') select(index + 1)
      }}
    >
      <div className="stage-track">
        {songs.map((song, i) => {
          const off = offsetOf(i)
          const center = off === 0
          const visible = Math.abs(off) <= 1
          return (
            <div
              key={song.id}
              className={`stage-item ${center ? 'is-center' : ''} ${off < 0 ? 'is-left' : ''} ${off > 0 ? 'is-right' : ''}`}
              style={{
                transform: `translateX(calc(-50% + ${off * SIDE_OFFSET_PX}px)) scale(${center ? 1 : 0.58})`,
                opacity: visible ? (center ? 1 : 0.55) : 0,
                zIndex: center ? 3 : visible ? 2 : 1,
                pointerEvents: visible ? undefined : 'none'
              }}
              aria-hidden={!center}
              onClick={center ? undefined : () => select(i)}
            >
              <div className="stage-float">
                <Cover song={song} releases={snapshot.releases} />
              </div>
            </div>
          )
        })}
      </div>

      {selected && (
        <div className="stage-info" aria-live="polite">
          {release && (
            <p className="focus-release" title={release.fromFolder ? 'From the release folder' : undefined}>
              {release.name}
            </p>
          )}
          {releaseProgress && (
            <div className="release-progress" title={statusBreakdown(releaseProgress.byStatus)}>
              <ProgressBar value={releaseProgress.value} label={`${release!.name} progress`} size="small" />
              <span>
                {percent(releaseProgress.value)} ·{' '}
                {releaseProgress.plannedTracks && releaseProgress.plannedTracks > releaseProgress.songCount
                  ? `${releaseProgress.songCount} of ${releaseProgress.plannedTracks} tracks`
                  : `${releaseProgress.songCount} ${releaseProgress.songCount === 1 ? 'song' : 'songs'}`}
              </span>
            </div>
          )}
          <div className="stage-pill stage-title">
            <span className="pill-key" aria-hidden="true" />
            <EditableTitle song={selected} />
          </div>
          {selected.setName && (
            <p className="focus-file" title={selected.path}>
              {selected.setName}.als
            </p>
          )}
          {selected.progress !== null && (
            <div className="song-progress">
              <StatusPill song={selected} />
              <ProgressBar value={selected.progress} label={`${selected.title} progress`} />
              <span className="song-progress-value">{percent(selected.progress)}</span>
            </div>
          )}
          <div className="focus-status">
            <LastWorked song={selected} thresholds={snapshot.staleness} />
          </div>
          <div className="focus-details">
            <Location song={selected} />
            <Bounced song={selected} />
            <SongTags song={selected} />
          </div>
          {selected.latestNext && <p className="next-note">Next: {selected.latestNext}</p>}
        </div>
      )}

      {songs.length > 1 && (
        <div className="stage-dots" aria-hidden="true">
          {songs.map((s, i) => (
            <span key={s.id} className={i === index ? 'dot active' : 'dot'} />
          ))}
        </div>
      )}

      {selected && (
        <>
          <div className="stage-corner left">
            <button className="stage-pill" disabled={index === 0} onClick={() => shift(-1)}>
              <span className="pill-key" aria-hidden="true" />
              Move left
            </button>
            <button className="stage-pill" disabled={index === songs.length - 1} onClick={() => shift(1)}>
              <span className="pill-key" aria-hidden="true" />
              Move right
            </button>
          </div>
          <div className="stage-corner right">
            <button className="stage-pill" onClick={() => onMove([selected.id], 'queue')}>
              <span className="pill-key" aria-hidden="true" />
              To Queue
            </button>
            <button className="stage-pill" onClick={() => onMove([selected.id], 'shelf')}>
              <span className="pill-key" aria-hidden="true" />
              To Shelf
            </button>
          </div>
        </>
      )}
    </section>
  )
}

// "2 finished, 1 mixing, 3 demo" for the release bar's tooltip.
function statusBreakdown(byStatus: Partial<Record<Status, number>>): string {
  return STATUSES.slice()
    .reverse()
    .filter((status) => byStatus[status])
    .map((status) => `${byStatus[status]} ${status}`)
    .join(', ')
}
