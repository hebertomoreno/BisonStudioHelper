// Loads and saves state.json. No Electron imports, so it can be unit tested.
import { promises as fs } from 'node:fs'
import type { ZodError } from 'zod'
import { z } from 'zod'
import { AppStateSchema, SETTINGS_KEYS, type AppState, type Settings } from '../shared/schema'
import { defaultState } from './defaults'
import type { LegacyReleases } from './releases'

const LegacyReleasesSchema = z.object({
  releases: z.array(
    z.object({
      name: z.string().min(1),
      type: z.enum(['single', 'EP', 'album', 'other']),
      released: z.boolean(),
      targetDate: z.string().nullable(),
      art: z.string().nullable().optional(),
      createdAt: z.string()
    })
  ),
  roots: z.array(
    z.object({
      path: z.string(),
      foldersPath: z.string().optional(),
      folders: z.record(z.object({ release: z.string() })).default({})
    })
  ),
  tracklists: z.record(z.array(z.string())).default({})
})

export function formatZodError(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const where = issue.path.length > 0 ? issue.path.join('.') : 'value'
    return `${where}: ${issue.message}`
  })
}

// Write to a temp file, then rename over the target, so a crash never leaves a half-written file.
export async function writeFileAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, data, 'utf8')
  await fs.rename(tmp, file)
}

export function pickSettings(state: AppState): Settings {
  const settings: Partial<Settings> = {}
  for (const key of SETTINGS_KEYS) {
    ;(settings as Record<string, unknown>)[key] = state[key]
  }
  return settings as Settings
}

export class StateStore {
  private state: AppState
  private writeQueue: Promise<void> = Promise.resolve()
  readonly warnings: string[] = []
  // Releases found in a state.json from before releases.json existed, for migration.
  legacyReleases: LegacyReleases | null = null

  constructor(
    private readonly file: string,
    private readonly home: string
  ) {
    this.state = defaultState(home)
  }

  get(): AppState {
    return this.state
  }

  async load(): Promise<void> {
    const defaults = defaultState(this.home)
    let raw: string
    try {
      raw = await fs.readFile(this.file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      this.state = defaults
      await this.persist()
      return
    }

    let loaded: unknown
    try {
      loaded = JSON.parse(raw)
    } catch {
      const backup = `${this.file}.corrupt-${Date.now()}`
      await fs.rename(this.file, backup)
      this.warnings.push(`state.json was not valid JSON; moved it to ${backup} and started from defaults`)
      this.state = defaults
      await this.persist()
      return
    }

    // Validate field by field, so one bad field falls back to its default instead of resetting everything.
    const source = (loaded && typeof loaded === 'object' ? loaded : {}) as Record<string, unknown>
    const legacy = LegacyReleasesSchema.safeParse(source)
    if (legacy.success) {
      this.legacyReleases = {
        releases: legacy.data.releases,
        links: legacy.data.roots.map((r) => ({ rootPath: r.path, foldersPath: r.foldersPath, folders: r.folders })),
        tracklists: legacy.data.tracklists
      }
    }
    const merged: Record<string, unknown> = {}
    for (const [key, schema] of Object.entries(AppStateSchema.shape)) {
      const fallback = defaults[key as keyof AppState]
      if (!(key in source)) {
        merged[key] = fallback
        continue
      }
      const result = schema.safeParse(source[key])
      if (result.success) {
        merged[key] = result.data
      } else {
        merged[key] = fallback
        this.warnings.push(`${key} in state.json was invalid and was reset to its default`)
      }
    }
    this.state = AppStateSchema.parse(merged)
  }

  // Applies a change, validates the whole state, and saves it. Throws the ZodError if invalid.
  async update(change: (current: AppState) => AppState): Promise<AppState> {
    const next = AppStateSchema.parse(change(this.state))
    this.state = next
    await this.persist()
    return next
  }

  private persist(): Promise<void> {
    const data = JSON.stringify(this.state, null, 2) + '\n'
    // Serialize writes so two quick updates cannot race on the temp file.
    this.writeQueue = this.writeQueue.then(() => writeFileAtomic(this.file, data))
    return this.writeQueue
  }
}
