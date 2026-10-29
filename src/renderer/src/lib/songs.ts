import type { LibrarySnapshot, SongSummary } from '../../../shared/songs'

const DAY_MS = 24 * 60 * 60 * 1000

export function daysSince(iso: string, now: number = Date.now()): number {
  return Math.floor((now - Date.parse(iso)) / DAY_MS)
}

// "today", "yesterday", "3 days ago", "2 weeks ago", "5 months ago", "2 years ago".
export function relativeTime(iso: string, now: number = Date.now()): string {
  const days = daysSince(iso, now)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`
  if (days < 730) return `${Math.floor(days / 30)} months ago`
  return `${Math.floor(days / 365)} years ago`
}

export type Staleness = 'fresh' | 'amber' | 'red'

export function staleness(iso: string | null, thresholds: LibrarySnapshot['staleness']): Staleness {
  if (!iso) return 'red'
  const days = daysSince(iso)
  if (days < thresholds.amberDays) return 'fresh'
  if (days <= thresholds.redDays) return 'amber'
  return 'red'
}

export function byLastWorked(a: SongSummary, b: SongSummary): number {
  const ta = a.lastWorkedAt ? Date.parse(a.lastWorkedAt) : 0
  const tb = b.lastWorkedAt ? Date.parse(b.lastWorkedAt) : 0
  return tb - ta || a.title.localeCompare(b.title)
}

// Songs of a lane in the stored manual order; songs missing from the order go last.
export function inManualOrder(songs: SongSummary[], order: string[]): SongSummary[] {
  const position = new Map(order.map((id, i) => [id, i]))
  return [...songs].sort((a, b) => {
    const pa = position.get(a.id) ?? Number.MAX_SAFE_INTEGER
    const pb = position.get(b.id) ?? Number.MAX_SAFE_INTEGER
    return pa - pb || byLastWorked(a, b)
  })
}

export function sortQueue(songs: SongSummary[], snapshot: LibrarySnapshot): SongSummary[] {
  switch (snapshot.queueSort) {
    case 'manual':
      return inManualOrder(songs, snapshot.order.queue)
    case 'excitement':
      return [...songs].sort((a, b) => (b.excitement ?? 0) - (a.excitement ?? 0) || byLastWorked(a, b))
    default:
      return [...songs].sort(byLastWorked)
  }
}

export function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

export function locationLabel(song: SongSummary): string {
  return song.folder ? `${song.rootLabel} · ${song.folder}` : song.rootLabel
}
