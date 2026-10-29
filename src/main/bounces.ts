// Finds a song's exported audio (SPEC section 7a). Read-only: never writes anything.
import { createHash } from 'node:crypto'
import { promises as fs, type Dirent } from 'node:fs'
import { extname, join } from 'node:path'
import { normalizeFolderName } from './scanner'

export const PLAYABLE_FORMATS = ['mp3', 'm4a', 'flac', 'wav'] as const
const LISTED_FORMATS = new Set<string>([...PLAYABLE_FORMATS, 'aif', 'aiff'])

export interface BounceFile {
  // Stable id used in bounce:// URLs, so the renderer never sends a path.
  id: string
  path: string
  format: string
  mtimeMs: number
}

export interface Bounce {
  // Basename without extension, e.g. "Song v3". What `pinnedBounce` stores.
  name: string
  // "bounces" = a bounce folder; "project" = loose in the project or wrapper folder.
  location: 'bounces' | 'project'
  files: BounceFile[]
  // Newest file mtime in the group.
  mtimeMs: number
}

export function bounceFileId(path: string): string {
  return createHash('sha1').update(path).digest('hex').slice(0, 20)
}

function formatOf(name: string): string | null {
  if (name.startsWith('.')) return null
  const ext = extname(name).slice(1).toLowerCase()
  return LISTED_FORMATS.has(ext) ? ext : null
}

async function readDir(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

// Audio files directly in `dir`. Symlinks are skipped (Dirent types come from lstat).
async function audioFiles(dir: string, entries: Dirent[]): Promise<BounceFile[]> {
  const files: BounceFile[] = []
  for (const e of entries) {
    const format = e.isFile() ? formatOf(e.name) : null
    if (!format) continue
    const path = join(dir, e.name)
    try {
      const stat = await fs.stat(path)
      files.push({ id: bounceFileId(path), path, format, mtimeMs: stat.mtimeMs })
    } catch {
      // Deleted between readdir and stat.
    }
  }
  return files
}

function group(files: BounceFile[], location: Bounce['location']): Bounce[] {
  const byName = new Map<string, BounceFile[]>()
  for (const f of files) {
    const name = f.path.slice(f.path.lastIndexOf('/') + 1, -(f.format.length + 1))
    const dirKey = f.path.slice(0, f.path.lastIndexOf('/')) + '/' + name
    byName.set(dirKey, [...(byName.get(dirKey) ?? []), f])
  }
  return [...byName.entries()].map(([key, group]) => ({
    name: key.slice(key.lastIndexOf('/') + 1),
    location,
    files: group,
    mtimeMs: Math.max(...group.map((f) => f.mtimeMs))
  }))
}

// Bounces of a project: top level of its bounce folders and loose audio, in the project
// folder and in its single-project wrapper. Newest first.
export async function findBounces(
  projectPath: string,
  wrapperPath: string | null,
  bounceFolderNames: string[]
): Promise<Bounce[]> {
  const names = new Set(bounceFolderNames.map(normalizeFolderName))
  const bounces: Bounce[] = []
  for (const dir of wrapperPath ? [projectPath, wrapperPath] : [projectPath]) {
    const entries = await readDir(dir)
    bounces.push(...group(await audioFiles(dir, entries), 'project'))
    for (const e of entries) {
      if (!e.isDirectory() || !names.has(normalizeFolderName(e.name))) continue
      const sub = join(dir, e.name)
      bounces.push(...group(await audioFiles(sub, await readDir(sub)), 'bounces'))
    }
  }
  return bounces.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

// The file to play for a bounce: MP3, then M4A, FLAC, WAV. Null when only AIFF exists.
export function playableFile(bounce: Bounce): BounceFile | null {
  for (const format of PLAYABLE_FORMATS) {
    const file = bounce.files.find((f) => f.format === format)
    if (file) return file
  }
  return null
}

// The song card's preview: the pinned bounce if it still exists, else the newest one.
export function previewBounce(bounces: Bounce[], pinned: string | null): Bounce | null {
  return (pinned ? bounces.find((b) => b.name === pinned) : undefined) ?? bounces[0] ?? null
}
