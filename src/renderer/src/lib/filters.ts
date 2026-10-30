import type { Status } from '../../../shared/sidecar'
import type { LibrarySnapshot, SongSummary } from '../../../shared/songs'

// A combination of filters (SPEC 8a, 9). Empty lists and nulls mean "any".
export interface SongFilter {
  status: Status[]
  // 1–5, or 0 for unrated.
  excitement: number[]
  releaseId: string | null
  folder: string | null
  rootPath: string | null
  bounce: 'any' | 'has' | 'none'
  hideReleased: boolean
}

export const EMPTY_FILTER: SongFilter = {
  status: [],
  excitement: [],
  releaseId: null,
  folder: null,
  rootPath: null,
  bounce: 'any',
  hideReleased: false
}

export function isEmptyFilter(f: SongFilter): boolean {
  return (
    f.status.length === 0 &&
    f.excitement.length === 0 &&
    !f.releaseId &&
    !f.folder &&
    !f.rootPath &&
    f.bounce === 'any' &&
    !f.hideReleased
  )
}

export function matchesFilter(song: SongSummary, f: SongFilter): boolean {
  if (f.status.length > 0 && (!song.status || !f.status.includes(song.status))) return false
  if (f.excitement.length > 0 && !f.excitement.includes(song.excitement ?? 0)) return false
  if (f.releaseId && !song.releases.some((r) => r.id === f.releaseId)) return false
  if (f.folder && song.folder !== f.folder) return false
  if (f.rootPath && song.rootPath !== f.rootPath) return false
  if (f.bounce === 'has' && song.bounceCount === 0) return false
  if (f.bounce === 'none' && song.bounceCount > 0) return false
  if (f.hideReleased && song.releases.length > 0 && song.releases.every((r) => r.released)) return false
  return true
}

// Saved filters are stored loosely in state.json; read them back field by field.
export function parseFilter(raw: Record<string, unknown>): SongFilter {
  const list = <T>(v: unknown, ok: (x: unknown) => x is T): T[] => (Array.isArray(v) ? v.filter(ok) : [])
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
  return {
    status: list(raw['status'], (x): x is Status => typeof x === 'string'),
    excitement: list(raw['excitement'], (x): x is number => typeof x === 'number'),
    releaseId: str(raw['releaseId']),
    folder: str(raw['folder']),
    rootPath: str(raw['rootPath']),
    bounce: raw['bounce'] === 'has' || raw['bounce'] === 'none' ? raw['bounce'] : 'any',
    hideReleased: raw['hideReleased'] === true
  }
}

// Folders that have songs, for the folder filter.
export function foldersOf(snapshot: LibrarySnapshot): string[] {
  return [...new Set(snapshot.songs.map((s) => s.folder).filter((f): f is string => !!f))].sort((a, b) =>
    a.localeCompare(b)
  )
}
