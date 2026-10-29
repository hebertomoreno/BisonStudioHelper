// Loads and saves releases.json, the release database (SPEC section 8b). No Electron imports.
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { ReleasesFileSchema, type Release, type ReleasesFile } from '../shared/releases'
import { formatZodError, writeFileAtomic } from './state'

// Releases and folder links as an older state.json stored them, before releases.json existed.
export interface LegacyReleases {
  releases: { name: string; type: Release['type']; released: boolean; targetDate: string | null; art?: string | null; createdAt: string }[]
  // rootPath → foldersPath, folder name → release name.
  links: { rootPath: string; foldersPath: string | undefined; folders: Record<string, { release: string }> }[]
  tracklists: Record<string, string[]>
}

function newRelease(fields: Partial<Release> & Pick<Release, 'name' | 'type' | 'released' | 'createdAt'>): Release {
  return {
    id: randomUUID(),
    targetDate: null,
    art: null,
    folder: null,
    plannedTracks: null,
    added: [],
    excluded: [],
    order: [],
    ...fields
  }
}

// This user's releases (SPEC section 0): four Feather folders, plus an old demo with no folder.
export function defaultReleases(now: Date = new Date()): ReleasesFile {
  const createdAt = now.toISOString()
  const feather = '/Volumes/Feather/Songs'
  return {
    schemaVersion: 1,
    releases: [
      ...['YearOfTheBrownBear', 'Filosofolk', 'The Forest', 'Emi Folder'].map((name) =>
        newRelease({ name, type: 'other', released: false, createdAt, folder: { rootPath: feather, path: `Projects/${name}` } })
      ),
      newRelease({ name: 'Nikolas Murdock Demo 2021', type: 'EP', released: true, createdAt })
    ]
  }
}

export function fromLegacy(legacy: LegacyReleases): ReleasesFile {
  return {
    schemaVersion: 1,
    releases: legacy.releases.map((r) => {
      const link = legacy.links
        .flatMap((l) => Object.entries(l.folders).map(([folder, v]) => ({ ...l, folder, release: v.release })))
        .find((l) => l.release === r.name)
      return newRelease({
        name: r.name,
        type: r.type,
        released: r.released,
        targetDate: r.targetDate,
        art: r.art ?? null,
        createdAt: r.createdAt,
        order: legacy.tracklists[r.name] ?? [],
        folder: link
          ? { rootPath: link.rootPath, path: link.foldersPath ? join(link.foldersPath, link.folder) : link.folder }
          : null
      })
    })
  }
}

export class ReleaseStore {
  private data: ReleasesFile = { schemaVersion: 1, releases: [] }
  private writeQueue: Promise<void> = Promise.resolve()
  readonly warnings: string[] = []

  constructor(private readonly file: string) {}

  all(): Release[] {
    return this.data.releases
  }

  find(id: string): Release | undefined {
    return this.data.releases.find((r) => r.id === id)
  }

  // `seed` is used when the file does not exist yet: releases migrated from state.json, or defaults.
  async load(seed: () => ReleasesFile): Promise<void> {
    let raw: string
    try {
      raw = await fs.readFile(this.file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      this.data = ReleasesFileSchema.parse(seed())
      await this.persist()
      return
    }

    let parsed: ReturnType<typeof ReleasesFileSchema.safeParse>
    try {
      parsed = ReleasesFileSchema.safeParse(JSON.parse(raw))
    } catch {
      parsed = { success: false } as typeof parsed
    }
    if (parsed.success) {
      this.data = parsed.data
      return
    }
    // Never start over silently: the user's release data would be lost on the next save.
    const backup = `${this.file}.corrupt-${Date.now()}`
    await fs.rename(this.file, backup)
    const why = parsed.error ? `: ${formatZodError(parsed.error).join('; ')}` : ''
    this.warnings.push(`releases.json could not be read${why}. Moved it to ${backup} and started from defaults.`)
    this.data = ReleasesFileSchema.parse(seed())
    await this.persist()
  }

  async update(change: (releases: Release[]) => Release[]): Promise<void> {
    this.data = ReleasesFileSchema.parse({ ...this.data, releases: change(this.data.releases) })
    await this.persist()
  }

  async updateOne(id: string, change: (release: Release) => Release): Promise<Release> {
    const current = this.find(id)
    if (!current) throw new Error('Unknown release')
    const next = change(current)
    await this.update((all) => all.map((r) => (r.id === id ? next : r)))
    return next
  }

  private persist(): Promise<void> {
    const data = JSON.stringify(this.data, null, 2) + '\n'
    this.writeQueue = this.writeQueue.then(() => writeFileAtomic(this.file, data))
    return this.writeQueue
  }
}
