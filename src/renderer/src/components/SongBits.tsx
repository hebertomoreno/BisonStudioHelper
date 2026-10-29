import type { LibrarySnapshot, SongSummary } from '../../../shared/songs'
import { locationLabel, relativeTime, staleness } from '../lib/songs'

export function LastWorked({
  song,
  thresholds
}: {
  song: SongSummary
  // Omit to show the date without staleness colors (Shelf).
  thresholds?: LibrarySnapshot['staleness']
}): JSX.Element {
  if (!song.lastWorkedAt) return <span className="muted">Never worked on</span>
  const tone = thresholds ? staleness(song.lastWorkedAt, thresholds) : 'fresh'
  return (
    <span className={`last-worked tone-${tone}`} title={new Date(song.lastWorkedAt).toLocaleString()}>
      {relativeTime(song.lastWorkedAt)}
    </span>
  )
}

export function Location({ song }: { song: SongSummary }): JSX.Element {
  return (
    <span className="location" title={song.path}>
      {locationLabel(song)}
    </span>
  )
}

export function StatusPill({ song }: { song: SongSummary }): JSX.Element | null {
  if (!song.status) return null
  return <span className={`status status-${song.status.replace(' ', '-')}`}>{song.status}</span>
}

const AVAILABILITY_TAG: Record<SongSummary['availability'], string | null> = {
  ok: null,
  'drive-not-connected': 'Drive not connected',
  'not-found': 'Folder not found',
  'invalid-sidecar': "Can't read .finisher.json"
}

export function SongTags({ song }: { song: SongSummary }): JSX.Element | null {
  const availability = AVAILABILITY_TAG[song.availability]
  if (!availability && !song.isNew && !song.duplicateOf) return null
  return (
    <span className="tags">
      {song.isNew && <span className="tag tag-new">New</span>}
      {song.duplicateOf && <span className="tag">Duplicate of {song.duplicateOf}</span>}
      {availability && (
        <span className="tag tag-warn" title={song.error ?? undefined}>
          {availability}
        </span>
      )}
    </span>
  )
}

export function RootNotices({ snapshot }: { snapshot: LibrarySnapshot }): JSX.Element | null {
  const offline = snapshot.roots.filter((r) => !r.mounted)
  if (offline.length === 0) return null
  return (
    <div className="notice warning" role="status">
      {offline.map((r) => (
        <p key={r.path}>
          {r.label} isn't connected.{' '}
          {r.songCount === 1 && 'Its song is shown from the last scan.'}
          {r.songCount > 1 && `Its ${r.songCount} songs are shown from the last scan.`}
        </p>
      ))}
    </div>
  )
}

// "Bounced 2 days ago" for the card's preview bounce (SPEC 7a).
export function Bounced({ song }: { song: SongSummary }): JSX.Element | null {
  if (!song.preview) return null
  return (
    <span className="bounced" title={`${song.preview.name} · ${new Date(song.preview.bouncedAt).toLocaleString()}`}>
      Bounced {relativeTime(song.preview.bouncedAt)}
    </span>
  )
}
