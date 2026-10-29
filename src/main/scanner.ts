// Finds Ableton project folders under a root (SPEC section 3). Read-only: never writes anything.
import { promises as fs, type Dirent } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { Root } from '../shared/schema'

export const SIDECAR_NAME = '.finisher.json'
const PROJECT_INFO = 'Ableton Project Info'
const ALWAYS_SKIP = new Set(['Backup', 'Samples', PROJECT_INFO])

export interface AlsFile {
  name: string
  mtimeMs: number
  size: number
}

export interface DiscoveredProject {
  path: string
  rootPath: string
  // First-level folder under the root's foldersPath, e.g. "Rough Ideas".
  folder: string | null
  // Topmost ancestor that holds only this project (its bounces count for the song, SPEC 7a).
  wrapperPath: string | null
  hasSidecar: boolean
  alsFiles: AlsFile[]
  // Newest .als in the project root.
  newestAls: AlsFile | null
}

export interface DiscoverResult {
  projects: DiscoveredProject[]
  warnings: string[]
}

// "Exported Files", "ExportedFiles" and "exported files" are the same name.
export function normalizeFolderName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '')
}

export function isAlsName(name: string): boolean {
  return name.toLowerCase().endsWith('.als') && !name.startsWith('.')
}

export interface SkipRules {
  exclude: string[]
  bounceFolderNames: string[]
}

// Whether the walk should skip a directory. `relPath` is relative to the root.
export function shouldSkipDir(name: string, relPath: string, rules: SkipRules): boolean {
  if (name.startsWith('.')) return true
  if (ALWAYS_SKIP.has(name)) return true
  const normalized = normalizeFolderName(name)
  if (rules.bounceFolderNames.some((b) => normalizeFolderName(b) === normalized)) return true
  // Entries with a slash are paths relative to the root; others match a folder name at any depth.
  return rules.exclude.some((e) => (e.includes('/') ? relPath === e.replace(/\/+$/, '') : e === name))
}

async function readDir(dir: string, warnings: string[]): Promise<Dirent[] | null> {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch (err) {
    warnings.push(`Could not read ${dir}: ${(err as NodeJS.ErrnoException).code ?? String(err)}`)
    return null
  }
}

async function statAls(dir: string, names: string[]): Promise<AlsFile[]> {
  const files: AlsFile[] = []
  for (const name of names) {
    try {
      const stat = await fs.stat(join(dir, name))
      files.push({ name, mtimeMs: stat.mtimeMs, size: stat.size })
    } catch {
      // Deleted between readdir and stat.
    }
  }
  return files
}

export async function discoverProjects(root: Root, bounceFolderNames: string[]): Promise<DiscoverResult> {
  const warnings: string[] = []
  const found: Omit<DiscoveredProject, 'wrapperPath'>[] = []
  const rules: SkipRules = { exclude: root.exclude, bounceFolderNames }
  const foldersBase = root.foldersPath ? join(root.path, root.foldersPath) : null

  function folderOf(projectPath: string): string | null {
    if (!foldersBase) return null
    const rel = relative(foldersBase, projectPath)
    if (rel.startsWith('..') || rel === '') return null
    const parts = rel.split(sep)
    // A project directly in foldersPath has no folder.
    return parts.length > 1 ? parts[0] : null
  }

  async function walk(dir: string, depth: number): Promise<void> {
    const entries = await readDir(dir, warnings)
    if (!entries) return

    // Dirent types come from lstat, so symlinks are neither directories nor files here and are skipped.
    const subdirs = entries.filter((e) => e.isDirectory())
    const alsNames = entries.filter((e) => e.isFile() && isAlsName(e.name)).map((e) => e.name)
    const isProject = depth > 0 && subdirs.some((e) => e.name === PROJECT_INFO) && alsNames.length > 0

    if (isProject) {
      const alsFiles = await statAls(dir, alsNames)
      const newestAls = alsFiles.reduce<AlsFile | null>((a, b) => (!a || b.mtimeMs > a.mtimeMs ? b : a), null)
      found.push({
        path: dir,
        rootPath: root.path,
        folder: folderOf(dir),
        hasSidecar: entries.some((e) => e.isFile() && e.name === SIDECAR_NAME),
        alsFiles,
        newestAls
      })
      // Projects are never nested inside projects.
      return
    }

    if (depth >= root.maxDepth) return
    for (const sub of subdirs) {
      const path = join(dir, sub.name)
      if (shouldSkipDir(sub.name, relative(root.path, path), rules)) continue
      await walk(path, depth + 1)
    }
  }

  await walk(root.path, 0)

  // Wrapper detection needs the full list. A folder can wrap a project only if it sits below
  // the root, below foldersPath, and below the first-level folder.
  const boundaries = new Set<string>([root.path])
  if (foldersBase) {
    boundaries.add(foldersBase)
    for (const p of found) {
      const folder = folderOf(p.path)
      if (folder) boundaries.add(join(foldersBase, folder))
    }
  }
  const countUnder = (dir: string): number =>
    found.filter((p) => p.path.startsWith(dir + sep)).length

  const projects = found.map((p) => {
    let wrapperPath: string | null = null
    let dir = p.path.slice(0, p.path.lastIndexOf(sep))
    while (!boundaries.has(dir) && dir.startsWith(root.path + sep)) {
      if (countUnder(dir) !== 1) break
      wrapperPath = dir
      dir = dir.slice(0, dir.lastIndexOf(sep))
    }
    return { ...p, wrapperPath }
  })

  return { projects, warnings }
}
