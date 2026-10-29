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

export interface SongSummary {
  id: string
  title: string
  path: string
  rootPath: string
  rootLabel: string
  // First-level folder under the root's foldersPath, e.g. "Rough Ideas".
  folder: string | null
  status: Status | null
  excitement: number | null
  latestNext: string | null
  lastWorkedAt: string | null
  lane: Lane
  availability: Availability
  isNew: boolean
  duplicateOf: string | null
  error: string | null
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
  roots: RootSummary[]
  scanning: boolean
  lastScanAt: string | null
  warnings: string[]
}

export type SetLaneResult =
  | { ok: true }
  // Moving these songs would exceed the Focus cap; the user must pick songs to move to Queue.
  | { ok: false; reason: 'focus-full'; focusCap: number; mustRemove: number }
