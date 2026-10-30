// Work sessions from .als saves (SPEC 7c): reads save times from Live's Backup/ folders and set
// mtimes, keeps them in activity.json, and groups them into sessions. Never writes to projects.
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { ActivityFileSchema, type ActivityFile, type Save, type WorkSession } from '../shared/activity'
import type { AlsFile } from './scanner'
import { formatZodError, writeFileAtomic } from './state'

const BACKUP_NAME = /^(.*) \[(\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})(\d{2})\]\.als$/i
const SAME_SAVE_MS = 2000
// More projects than this saved in the same minute is a bulk copy, not work (SPEC 7c).
const BULK_COPY_PROJECTS = 3

export interface FoundSave {
  at: number
  set: string
  source: Save['source']
}

// "WeAreNotToBlame [2026-10-08 174115].als" → the set name and the save time (local time).
export function parseBackupName(name: string): { set: string; at: number } | null {
  const m = BACKUP_NAME.exec(name)
  if (!m) return null
  const [, set, y, mo, d, h, mi, s] = m
  const at = new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime()
  return Number.isFinite(at) ? { set, at } : null
}

// Save times visible in a project: each backup's name is a save (when the backup was made), each
// backup's mtime is the save before it, and each set's mtime is its latest save.
export async function findSaves(projectPath: string, alsFiles: AlsFile[]): Promise<FoundSave[]> {
  const saves: FoundSave[] = alsFiles.map((f) => ({ at: f.mtimeMs, set: f.name.replace(/\.als$/i, ''), source: 'mtime' }))
  let entries: import('node:fs').Dirent[] = []
  try {
    entries = await fs.readdir(join(projectPath, 'Backup'), { withFileTypes: true })
  } catch {
    return saves
  }
  for (const e of entries) {
    if (!e.isFile() || e.name.startsWith('.')) continue
    const parsed = parseBackupName(e.name)
    if (!parsed) continue
    saves.push({ at: parsed.at, set: parsed.set, source: 'backup' })
    try {
      const stat = await fs.stat(join(projectPath, 'Backup', e.name))
      saves.push({ at: stat.mtimeMs, set: parsed.set, source: 'mtime' })
    } catch {
      // Deleted between readdir and stat.
    }
  }
  return saves
}

// Drops mtime-based saves from minutes in which many projects changed at once.
export function dropBulkCopies(byProject: Map<string, FoundSave[]>): void {
  const projectsPerMinute = new Map<number, Set<string>>()
  for (const [project, saves] of byProject) {
    for (const s of saves) {
      if (s.source !== 'mtime') continue
      const minute = Math.floor(s.at / 60_000)
      projectsPerMinute.set(minute, (projectsPerMinute.get(minute) ?? new Set()).add(project))
    }
  }
  for (const [project, saves] of byProject) {
    byProject.set(
      project,
      saves.filter((s) => s.source !== 'mtime' || (projectsPerMinute.get(Math.floor(s.at / 60_000))?.size ?? 0) <= BULK_COPY_PROJECTS)
    )
  }
}

// Groups saves (and Open in Live sessions) into sessions: saves less than `gapHours` apart are one.
export function toSessions(
  saves: Save[],
  explicit: { startedAt: string; endedAt: string | null }[],
  gapHours: number
): WorkSession[] {
  const gap = gapHours * 3_600_000
  const times = saves.map((s) => Date.parse(s.at)).filter(Number.isFinite).sort((a, b) => a - b)
  const sessions: { start: number; end: number; saveCount: number; explicit: boolean }[] = []
  for (const t of times) {
    const last = sessions.at(-1)
    if (last && t - last.end < gap) {
      last.end = t
      last.saveCount++
    } else {
      sessions.push({ start: t, end: t, saveCount: 1, explicit: false })
    }
  }
  // An explicit session absorbs the inferred ones it overlaps.
  for (const e of explicit) {
    const start = Date.parse(e.startedAt)
    const end = e.endedAt ? Date.parse(e.endedAt) : start
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    const overlapping = sessions.filter((s) => s.end >= start - gap && s.start <= end + gap)
    const merged = {
      start: Math.min(start, ...overlapping.map((s) => s.start)),
      end: Math.max(end, ...overlapping.map((s) => s.end)),
      saveCount: overlapping.reduce((n, s) => n + s.saveCount, 0),
      explicit: true
    }
    for (const s of overlapping) sessions.splice(sessions.indexOf(s), 1)
    sessions.push(merged)
  }
  return sessions
    .sort((a, b) => a.start - b.start)
    .map((s) => ({
      start: new Date(s.start).toISOString(),
      end: new Date(s.end).toISOString(),
      saveCount: s.saveCount,
      explicit: s.explicit
    }))
}

export class ActivityStore {
  private data: ActivityFile = { schemaVersion: 1, saves: {} }
  private writeQueue: Promise<void> = Promise.resolve()
  readonly warnings: string[] = []

  constructor(private readonly file: string) {}

  saves(songId: string): Save[] {
    return this.data.saves[songId] ?? []
  }

  async load(): Promise<void> {
    let raw: string
    try {
      raw = await fs.readFile(this.file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      return
    }
    let parsed: ReturnType<typeof ActivityFileSchema.safeParse> | null = null
    try {
      parsed = ActivityFileSchema.safeParse(JSON.parse(raw))
    } catch {
      parsed = null
    }
    if (parsed?.success) {
      this.data = parsed.data
      return
    }
    // The backups still on disk rebuild most of it on the next scan.
    const backup = `${this.file}.corrupt-${Date.now()}`
    await fs.rename(this.file, backup)
    const why = parsed && !parsed.success ? `: ${formatZodError(parsed.error).join('; ')}` : ''
    this.warnings.push(`activity.json could not be read${why}. Moved it to ${backup}; save history is rebuilt from backups.`)
  }

  // Adds saves not already known (same set within 2 s). Returns whether anything was added.
  merge(songId: string, found: FoundSave[]): boolean {
    const known = [...this.saves(songId)]
    let added = false
    for (const f of found) {
      if (!Number.isFinite(f.at)) continue
      const dupe = known.some((k) => k.set === f.set && Math.abs(Date.parse(k.at) - f.at) <= SAME_SAVE_MS)
      if (dupe) continue
      known.push({ at: new Date(f.at).toISOString(), set: f.set, source: f.source })
      added = true
    }
    if (added) {
      known.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
      this.data = { ...this.data, saves: { ...this.data.saves, [songId]: known } }
    }
    return added
  }

  persist(): Promise<void> {
    const data = JSON.stringify(this.data) + '\n'
    this.writeQueue = this.writeQueue.then(() => writeFileAtomic(this.file, data))
    return this.writeQueue
  }
}
