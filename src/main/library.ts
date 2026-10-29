// The song index: combines scans of mounted roots with songCache for unmounted ones (SPEC sections 1–4).
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, join, sep } from 'node:path'
import type { AppState, Root, SongCacheEntry } from '../shared/schema'
import type { Sidecar } from '../shared/sidecar'
import {
  artUrl,
  bounceUrl,
  type BouncePreview,
  type Lane,
  type LibrarySnapshot,
  type QueueSort,
  type ReleaseProgress,
  type SetLaneResult,
  type SongRelease,
  type SongSummary
} from '../shared/songs'
import { findBounces, playableFile, previewBounce, type Bounce } from './bounces'
import type { ReleaseStore } from './releases'
import { discoverProjects, type AlsFile, type DiscoveredProject } from './scanner'
import {
  createSidecarFile,
  defaultTitle,
  newSidecar,
  readSidecar,
  writeSidecar,
  type SelfWrites
} from './sidecar'
import type { StateStore } from './state'

interface SongRecord {
  id: string
  path: string
  rootPath: string
  folder: string | null
  wrapperPath: string | null
  sidecar: Sidecar
  newestAls: AlsFile | null
  bounces: Bounce[]
}

interface Candidate {
  project: DiscoveredProject
  sidecar: Sidecar
}

export function lastWorkedAt(sidecar: Sidecar, newestAls: AlsFile | null): string | null {
  const times: number[] = []
  if (newestAls) times.push(newestAls.mtimeMs)
  for (const s of sidecar.sessions) {
    if (s.endedAt) times.push(Date.parse(s.endedAt))
  }
  const valid = times.filter((t) => Number.isFinite(t))
  return valid.length > 0 ? new Date(Math.max(...valid)).toISOString() : null
}

export function latestNext(sidecar: Sidecar): string | null {
  for (let i = sidecar.sessions.length - 1; i >= 0; i--) {
    const next = sidecar.sessions[i].next.trim()
    if (next) return next
  }
  return null
}

function isInside(path: string, dir: string): boolean {
  return path.startsWith(dir.replace(/\/+$/, '') + sep)
}

// A release's progress: its songs' weights over max(song count, planned tracks) (SPEC 8c).
export function releaseProgress(members: SongSummary[], plannedTracks: number | null): ReleaseProgress {
  const byStatus: ReleaseProgress['byStatus'] = {}
  let sum = 0
  for (const song of members) {
    if (song.status) byStatus[song.status] = (byStatus[song.status] ?? 0) + 1
    sum += song.progress ?? 0
  }
  const slots = Math.max(members.length, plannedTracks ?? 0)
  return { value: slots > 0 ? sum / slots : 0, songCount: members.length, plannedTracks, byStatus }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function birthtime(path: string): Promise<number> {
  try {
    return (await fs.stat(path)).birthtimeMs
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export class Library {
  private songs = new Map<string, SongRecord>()
  private invalid = new Map<string, SongSummary>()
  private mounted = new Map<string, boolean>()
  private scanChain: Promise<void> = Promise.resolve()
  private scansRunning = 0
  private lastScanAt: string | null = null
  private warnings: string[] = []

  constructor(
    private readonly store: StateStore,
    private readonly releases: ReleaseStore,
    private readonly selfWrites: SelfWrites,
    private readonly onChange: () => void
  ) {}

  isScanning(): boolean {
    return this.scansRunning > 0
  }

  // Re-checks which roots are mounted. Returns the paths of roots whose state changed.
  async refreshMounts(): Promise<string[]> {
    const changed: string[] = []
    for (const root of this.store.get().roots) {
      const now = await isDirectory(root.path)
      if (this.mounted.get(root.path) !== now) changed.push(root.path)
      this.mounted.set(root.path, now)
      if (!now) {
        for (const [id, record] of this.songs) {
          if (record.rootPath === root.path) this.songs.delete(id)
        }
      }
    }
    return changed
  }

  notifyChanged(): void {
    this.onChange()
  }

  isMounted(rootPath: string): boolean {
    return this.mounted.get(rootPath) ?? false
  }

  // Scans the given roots (all roots when omitted). Scans run one at a time, in order.
  scan(rootPaths?: string[]): Promise<void> {
    this.scansRunning++
    this.onChange()
    const run = this.scanChain.then(() => this.doScan(rootPaths))
    this.scanChain = run
      .catch((err) => {
        this.warnings = [`Scan failed: ${String(err)}`]
      })
      .finally(() => {
        this.scansRunning--
        this.onChange()
      })
    return this.scanChain
  }

  private async doScan(rootPaths?: string[]): Promise<void> {
    const state = this.store.get()
    const roots = state.roots.filter((r) => !rootPaths || rootPaths.includes(r.path))
    await this.refreshMounts()
    const scanned = roots.filter((r) => this.isMounted(r.path))
    const scannedPaths = new Set(scanned.map((r) => r.path))
    const firstScan = Object.keys(state.songCache).length === 0
    const warnings: string[] = []

    const projects: DiscoveredProject[] = []
    for (const root of scanned) {
      const result = await discoverProjects(root, state.bounceFolderNames)
      projects.push(...result.projects)
      warnings.push(...result.warnings)
    }

    // Forget what we knew about the scanned roots; the scan is the new truth for them.
    for (const [id, record] of this.songs) {
      if (scannedPaths.has(record.rootPath)) this.songs.delete(id)
    }
    for (const [path, summary] of this.invalid) {
      if (scannedPaths.has(summary.rootPath)) this.invalid.delete(path)
    }

    const candidates: Candidate[] = []
    const created: string[] = []
    for (const project of projects) {
      const result = project.hasSidecar ? await readSidecar(project.path) : ({ kind: 'missing' } as const)
      if (result.kind === 'ok') {
        candidates.push({ project, sidecar: result.sidecar })
      } else if (result.kind === 'invalid') {
        warnings.push(`Unreadable .finisher.json in ${project.path} (${result.error}); left untouched`)
        this.invalid.set(project.path, this.invalidSummary(project, result.error))
      } else {
        const sidecar = newSidecar(project.path)
        try {
          await createSidecarFile(project.path, sidecar, this.selfWrites)
          candidates.push({ project, sidecar })
          created.push(sidecar.id)
        } catch (err) {
          warnings.push(`Could not create .finisher.json in ${project.path}: ${String(err)}`)
        }
      }
    }

    const duplicates = await this.resolveDuplicateIds(candidates, state, warnings)

    for (const { project, sidecar } of candidates) {
      this.songs.set(sidecar.id, {
        id: sidecar.id,
        path: project.path,
        rootPath: project.rootPath,
        folder: project.folder,
        wrapperPath: project.wrapperPath,
        sidecar,
        newestAls: project.newestAls,
        bounces: await findBounces(project.path, project.wrapperPath, state.bounceFolderNames)
      })
    }

    const seenAt = new Date().toISOString()
    const foundIds = new Set(candidates.map((c) => c.sidecar.id))
    await this.store.update((s) => {
      const songCache = { ...s.songCache }
      const lanes = { ...s.lanes }
      const songFlags = { ...s.songFlags }
      for (const id of foundIds) {
        const record = this.songs.get(id)!
        songCache[id] = this.cacheEntry(record, seenAt)
        if (!lanes[id]) lanes[id] = 'shelf'
      }
      for (const [id, entry] of Object.entries(songCache)) {
        if (scannedPaths.has(entry.rootPath) && !foundIds.has(id) && !entry.notFound) {
          songCache[id] = { ...entry, notFound: true }
        }
      }
      if (!firstScan) {
        for (const id of created) songFlags[id] = { ...songFlags[id], new: true }
      }
      for (const [id, original] of duplicates) {
        songFlags[id] = { ...songFlags[id], new: true, duplicateOf: original }
      }
      return { ...s, songCache, lanes, songFlags }
    })

    this.lastScanAt = seenAt
    this.warnings = warnings
  }

  // When two folders hold the same id (a project duplicated in Finder), the folder already known
  // for that id keeps it; otherwise the older folder does. The others get a new id (SPEC 3).
  // Returns new id → title of the original.
  private async resolveDuplicateIds(
    candidates: Candidate[],
    state: AppState,
    warnings: string[]
  ): Promise<Map<string, string>> {
    const duplicates = new Map<string, string>()
    const byId = new Map<string, Candidate[]>()
    for (const c of candidates) {
      byId.set(c.sidecar.id, [...(byId.get(c.sidecar.id) ?? []), c])
    }

    for (const [id, group] of byId) {
      // A song on a root that was not part of this scan also claims its id, unless its folder is
      // gone (it was moved into a scanned root).
      let other = this.songs.get(id)
      if (other && !(await isDirectory(other.path))) {
        this.songs.delete(id)
        other = undefined
      }
      const knownPath = other?.path ?? state.songCache[id]?.path
      if (group.length === 1 && !other) continue

      let keeper: Candidate | null = group.find((c) => c.project.path === knownPath) ?? null
      if (!keeper && !other) {
        const times = await Promise.all(group.map((c) => birthtime(c.project.path)))
        keeper = group[times.indexOf(Math.min(...times))]
      }
      const originalTitle = keeper?.sidecar.title ?? other!.sidecar.title

      for (const c of group) {
        if (c === keeper) continue
        const renamed: Sidecar = { ...c.sidecar, id: randomUUID() }
        try {
          await writeSidecar(c.project.path, renamed, this.selfWrites)
          c.sidecar = renamed
          duplicates.set(renamed.id, originalTitle)
        } catch (err) {
          warnings.push(`Could not give the duplicate in ${c.project.path} a new id: ${String(err)}`)
        }
      }
    }

    // Candidates that failed to get a new id would still collide; drop all but the first.
    const seen = new Set<string>()
    for (let i = candidates.length - 1; i >= 0; i--) {
      const id = candidates[i].sidecar.id
      if (seen.has(id)) candidates.splice(i, 1)
      seen.add(id)
    }
    return duplicates
  }

  private cacheEntry(record: SongRecord, seenAt: string): SongCacheEntry {
    const { sidecar } = record
    return {
      path: record.path,
      rootPath: record.rootPath,
      folder: record.folder,
      title: sidecar.title,
      status: sidecar.status,
      excitement: sidecar.excitement,
      latestNext: latestNext(sidecar),
      lastWorkedAt: lastWorkedAt(sidecar, record.newestAls),
      collectState: (sidecar.collect?.['state'] as string | undefined) ?? 'unknown',
      setName: record.newestAls ? record.newestAls.name.replace(/\.als$/i, '') : null,
      seenAt,
      notFound: false
    }
  }

  private rootLabel(rootPath: string): string {
    return this.store.get().roots.find((r) => r.path === rootPath)?.label ?? basename(rootPath)
  }

  private invalidSummary(project: DiscoveredProject, error: string): SongSummary {
    return {
      id: `invalid:${project.path}`,
      title: defaultTitle(project.path),
      setName: null,
      path: project.path,
      rootPath: project.rootPath,
      rootLabel: this.rootLabel(project.rootPath),
      folder: project.folder,
      status: null,
      progress: null,
      excitement: null,
      latestNext: null,
      lastWorkedAt: null,
      lane: 'shelf',
      availability: 'invalid-sidecar',
      isNew: false,
      duplicateOf: null,
      error,
      releases: [],
      preview: null,
      bounceCount: 0
    }
  }

  // Releases a song is on, folder release first (SPEC 8b). Membership comes from releases.json:
  // songs under a release's folder, minus `excluded`, plus `added`.
  private songReleases(id: string, path: string): SongRelease[] {
    const result: SongRelease[] = []
    for (const r of this.releases.all()) {
      const inFolder = r.folder !== null && isInside(path, join(r.folder.rootPath, r.folder.path))
      const added = r.added.includes(id)
      if (!added && (!inFolder || r.excluded.includes(id))) continue
      result.push({
        id: r.id,
        name: r.name,
        fromFolder: inFolder && !added,
        released: r.released,
        artUrl: r.art ? artUrl(r.art) : null
      })
    }
    return result.sort((a, b) => Number(b.fromFolder) - Number(a.fromFolder))
  }

  private preview(record: SongRecord): BouncePreview | null {
    const bounce = previewBounce(record.bounces, record.sidecar.pinnedBounce)
    if (!bounce) return null
    const file = playableFile(bounce)
    return {
      name: bounce.name,
      bouncedAt: new Date(bounce.mtimeMs).toISOString(),
      url: file ? bounceUrl(file.id) : null,
      format: file?.format ?? null
    }
  }

  // Path of a bounce file found by the last scan, for the bounce:// protocol.
  bounceFilePath(id: string): string | null {
    for (const record of this.songs.values()) {
      for (const bounce of record.bounces) {
        const file = bounce.files.find((f) => f.id === id)
        if (file) return file.path
      }
    }
    return null
  }

  snapshot(): LibrarySnapshot {
    const state = this.store.get()
    const rootPaths = new Set(state.roots.map((r) => r.path))
    const songs: SongSummary[] = []

    for (const [id, entry] of Object.entries(state.songCache)) {
      // Songs of a root the user removed stay cached but are not shown.
      if (!rootPaths.has(entry.rootPath)) continue
      const record = this.songs.get(id)
      const flags = state.songFlags[id] ?? {}
      const availability: SongSummary['availability'] = !this.isMounted(entry.rootPath)
        ? 'drive-not-connected'
        : !record && entry.notFound
          ? 'not-found'
          : 'ok'
      songs.push({
        id,
        title: record?.sidecar.title ?? entry.title,
        setName: entry.setName,
        path: entry.path,
        rootPath: entry.rootPath,
        rootLabel: this.rootLabel(entry.rootPath),
        folder: entry.folder,
        status: (record?.sidecar.status ?? entry.status) as SongSummary['status'],
        progress: null,
        excitement: entry.excitement,
        latestNext: entry.latestNext,
        lastWorkedAt: entry.lastWorkedAt,
        lane: state.lanes[id] ?? 'shelf',
        availability,
        isNew: flags.new === true,
        duplicateOf: flags.duplicateOf ?? null,
        error: null,
        releases: this.songReleases(id, entry.path),
        preview: record ? this.preview(record) : null,
        bounceCount: record?.bounces.length ?? 0
      })
    }
    for (const song of songs) {
      song.progress = song.status ? (state.progressWeights[song.status] ?? null) : null
    }
    for (const summary of this.invalid.values()) {
      if (rootPaths.has(summary.rootPath)) songs.push(summary)
    }

    return {
      songs,
      order: state.order,
      focusCap: state.focusCap,
      queueSort: state.queueSort,
      staleness: state.staleness,
      roots: state.roots.map((r: Root) => ({
        path: r.path,
        label: r.label,
        mounted: this.isMounted(r.path),
        songCount: songs.filter((s) => s.rootPath === r.path).length
      })),
      releases: this.releases.all().map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        released: r.released,
        artUrl: r.art ? artUrl(r.art) : null,
        progress: releaseProgress(
          songs.filter((s) => s.releases.some((sr) => sr.id === r.id)),
          r.plannedTracks
        )
      })),
      scanning: this.isScanning(),
      lastScanAt: this.lastScanAt,
      warnings: this.warnings
    }
  }

  // Moves songs to a lane (SPEC section 1). `bumpToQueue` makes room in Focus when it is full.
  async setLane(ids: string[], lane: Lane, bumpToQueue: string[] = []): Promise<SetLaneResult> {
    const state = this.store.get()
    const known = ids.filter((id) => id in state.songCache)
    const bump = bumpToQueue.filter((id) => state.lanes[id] === 'focus' && !known.includes(id))

    if (lane === 'focus') {
      const focusNow = Object.keys(state.lanes).filter((id) => state.lanes[id] === 'focus')
      const adding = known.filter((id) => state.lanes[id] !== 'focus')
      const total = focusNow.length - bump.length + adding.length
      if (total > state.focusCap) {
        return { ok: false, reason: 'focus-full', focusCap: state.focusCap, mustRemove: total - state.focusCap }
      }
    }

    await this.store.update((s) => {
      const lanes = { ...s.lanes }
      const songFlags = { ...s.songFlags }
      const moving = new Set([...known, ...bump])
      const order = {
        focus: s.order.focus.filter((id) => !moving.has(id)),
        queue: s.order.queue.filter((id) => !moving.has(id))
      }
      for (const id of bump) {
        lanes[id] = 'queue'
        order.queue.push(id)
      }
      for (const id of known) {
        lanes[id] = lane
        if (lane !== 'shelf') {
          order[lane].push(id)
          if (songFlags[id]?.new) songFlags[id] = { ...songFlags[id], new: false }
        }
      }
      return { ...s, lanes, order, songFlags }
    })
    this.onChange()
    return { ok: true }
  }

  // Sets the manual order of a lane. Ids not given keep their relative order after the given ones.
  async reorder(lane: 'focus' | 'queue', ids: string[]): Promise<void> {
    await this.store.update((s) => {
      const inLane = (id: string): boolean => s.lanes[id] === lane
      const given = ids.filter(inLane)
      const rest = s.order[lane].filter((id) => inLane(id) && !given.includes(id))
      return { ...s, order: { ...s.order, [lane]: [...given, ...rest] } }
    })
    this.onChange()
  }

  async setQueueSort(queueSort: QueueSort): Promise<void> {
    await this.store.update((s) => ({ ...s, queueSort }))
    this.onChange()
  }

  // Renames the song in its sidecar. The project folder and .als files keep their names.
  async setTitle(id: string, title: string): Promise<void> {
    const trimmed = title.trim()
    if (!trimmed || trimmed.length > 200) throw new Error('A title needs 1 to 200 characters')
    const record = this.songs.get(id)
    if (!record) throw new Error("The song's drive isn't connected, so it can't be renamed now")
    const sidecar: Sidecar = { ...record.sidecar, title: trimmed }
    await writeSidecar(record.path, sidecar, this.selfWrites)
    record.sidecar = sidecar
    await this.store.update((s) => {
      const entry = s.songCache[id]
      return entry ? { ...s, songCache: { ...s.songCache, [id]: { ...entry, title: trimmed } } } : s
    })
    this.onChange()
  }

  // Puts a song on a release (SPEC 8b). Only releases.json changes; the song's folder and
  // sidecar are not touched, so this works for songs on an unmounted drive too.
  async addSongToRelease(songId: string, releaseId: string): Promise<void> {
    const entry = this.store.get().songCache[songId]
    if (!entry) throw new Error('Unknown song')
    await this.releases.updateOne(releaseId, (r) => {
      const inFolder = r.folder !== null && isInside(entry.path, join(r.folder.rootPath, r.folder.path))
      return {
        ...r,
        excluded: r.excluded.filter((id) => id !== songId),
        added: inFolder || r.added.includes(songId) ? r.added : [...r.added, songId]
      }
    })
    this.onChange()
  }

  // Sets a release's cover file name. Returns the file it replaced, for the caller to delete.
  async setReleaseArt(releaseId: string, art: string | null): Promise<string | null> {
    const previous = this.releases.find(releaseId)?.art ?? null
    await this.releases.updateOne(releaseId, (r) => ({ ...r, art }))
    this.onChange()
    return previous
  }
}
