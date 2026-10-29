import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Root } from '../src/shared/schema'

export async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

// Creates an Ableton project folder. `als` maps file name to mtime in seconds since epoch.
export async function makeProject(dir: string, als: Record<string, number> = { 'Song.als': 1_700_000_000 }): Promise<string> {
  await mkdir(join(dir, 'Ableton Project Info'), { recursive: true })
  for (const [name, mtime] of Object.entries(als)) {
    const file = join(dir, name)
    await writeFile(file, 'not really gzip')
    await utimes(file, mtime, mtime)
  }
  return dir
}

export async function makeSymlink(target: string, link: string): Promise<void> {
  await symlink(target, link)
}

export function root(path: string, overrides: Partial<Root> = {}): Root {
  return { path, label: 'Test', maxDepth: 6, exclude: [], ...overrides }
}
