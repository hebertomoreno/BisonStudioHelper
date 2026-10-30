// What the renderer gets about songs. Built in main from scans plus songCache.
import type { AppState } from './schema'
import type { Status } from './sidecar'

export type Lane = 'focus' | 'queue' | 'shelf'
export type QueueSort = AppState['queueSort']

export type Availability =
  | 'ok'
  // The song's root is on a drive that is not mounted; data comes from songCache.
  | 'drive-not-connected'
  // The root is mounted but the folder was not found in the last scan.
  | 'not-found'
  // .finisher.json exists but could not be read; the app leaves it untouched.
  | 'invalid-sidecar'

// Custom-scheme URLs served by main (src/main/media.ts).
export const bounceUrl = (fileId: string): string => `bounce://file/${fileId}`
export const artUrl = (fileName: string): string => `art://file/${encodeURIComponent(fileName)}`

export interface SongRelease {
  id: string
  name: string
  // Inferred from the linked folder the song sits in, not tagged by the user (SPEC 8b).
  fromFolder: boolean
  released: boolean
  artUrl: string | null
}

export interface BouncePreview {
  name: string
  // ISO date of the newest file in the bounce.
  bouncedAt: string
  // Null when the bounce only exists as AIFF, which Chromium cannot play.
  url: string | null
  format: string | null
}

export interface ReleaseProgress {
  // 0 to 1: the songs' weights over max(song count, planned tracks).
  value: number
  songCount: number
  plannedTracks: number | null
  byStatus: Partial<Record<Status, number>>
  // Sessions on the release's songs in the last 30 days.
  sessions30d: number
}

export interface ReleaseSummary {
  id: string
  name: string
  type: string
  released: boolean
  artUrl: string | null
  progress: ReleaseProgress
}

export interface SongSummary {
  id: string
  // The song's name, set in the app. Starts as the project folder name.
  title: string
  // The newest .als without the extension, e.g. "WeAreNotToBlameCopyToFinish".
  setName: string | null
  path: string
  rootPath: string
  rootLabel: string
  // First-level folder under the root's foldersPath, e.g. "Rough Ideas".
  folder: string | null
  status: Status | null
  statusSince: string | null
  // The status's weight, 0 to 1 (SPEC 8c). Null when the status is unknown.
  progress: number | null
  excitement: number | null
  latestNext: string | null
  lastWorkedAt: string | null
  lane: Lane
  availability: Availability
  isNew: boolean
  duplicateOf: string | null
  error: string | null
  // Primary release first.
  releases: SongRelease[]
  // Pinned bounce, else the newest. Null when there are none or the drive is not mounted.
  preview: BouncePreview | null
  bounceCount: number
  sessions: SessionStats
}

// Work sessions from saves and Open in Live (SPEC 7c).
export interface SessionStats {
  count: number
  lastAt: string | null
  // Sessions since the song entered its current status ("Mixing · 6 sessions over 5 weeks").
  inStatus: number
  // Start of the first session in the current status.
  firstInStatusAt: string | null
  // Sum of session spans; a lower bound, since time before a session's first save is unknown.
  hours: number
}

export interface RootSummary {
  path: string
  label: string
  mounted: boolean
  songCount: number
}

export interface LibrarySnapshot {
  songs: SongSummary[]
  // Manual order of Focus and Queue, as song ids.
  order: { focus: string[]; queue: string[] }
  focusCap: number
  queueSort: QueueSort
  staleness: AppState['staleness']
  excitementScale: AppState['excitementScale']
  savedFilters: AppState['savedFilters']
  roots: RootSummary[]
  releases: ReleaseSummary[]
  scanning: boolean
  lastScanAt: string | null
  warnings: string[]
}

export type SetLaneResult =
  | { ok: true }
  // Moving these songs would exceed the Focus cap; the user must pick songs to move to Queue.
  | { ok: false; reason: 'focus-full'; focusCap: number; mustRemove: number }
