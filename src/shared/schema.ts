// Shapes of state.json (SPEC section 2). Shared by main (validation) and renderer (types only).
import { z } from 'zod'

const absolutePath = z
  .string()
  .min(1)
  .refine((p) => p.startsWith('/'), { message: 'must be an absolute path' })

export const RootSchema = z.object({
  path: absolutePath,
  label: z.string().trim().min(1, 'label is required'),
  maxDepth: z.number().int().min(1).max(12),
  exclude: z.array(z.string().trim().min(1)),
  // First-level folders under this subpath are "folders" (SPEC 8b). Unset = the root has none.
  foldersPath: z.string().trim().min(1).optional()
})

export const ExcitementLevelSchema = z.object({
  value: z.number().int().min(1).max(5),
  emoji: z.string().min(1),
  label: z.string()
})

export const LaneSchema = z.enum(['focus', 'queue', 'shelf'])

export const SongCacheEntrySchema = z.object({
  path: z.string(),
  rootPath: z.string(),
  folder: z.string().nullable().default(null),
  title: z.string(),
  status: z.string(),
  // When the song entered its current status (latest statusHistory entry).
  statusSince: z.string().nullable().default(null),
  excitement: z.number().nullable(),
  latestNext: z.string().nullable(),
  lastWorkedAt: z.string().nullable(),
  collectState: z.string(),
  // Newest .als in the project, without the extension (what the file is called, vs. the song title).
  setName: z.string().nullable().default(null),
  seenAt: z.string(),
  // True when the root was mounted at the last scan but the folder was not found.
  notFound: z.boolean().default(false)
})

export const SongFlagsSchema = z.object({
  // Discovered after the first scan and not yet out of the Shelf.
  new: z.boolean().optional(),
  // Title of the song this one was duplicated from (same id found in two folders).
  duplicateOf: z.string().optional()
})

export const AppStateSchema = z.object({
  schemaVersion: z.literal(1),
  roots: z.array(RootSchema),
  focusCap: z.number().int().min(1).max(10),
  lanes: z.record(LaneSchema),
  order: z.object({ focus: z.array(z.string()), queue: z.array(z.string()) }),
  queueSort: z.enum(['lastWorked', 'excitement', 'manual']),
  abletonAppName: z.string().trim().min(1),
  allowedExternalRoots: z.array(absolutePath),
  bounceFolderNames: z.array(z.string().trim().min(1)).min(1),
  inboxPaths: z.array(absolutePath),
  inbox: z.object({
    ignored: z.array(z.string()),
    matchThreshold: z.number().int().min(0).max(100)
  }),
  // How far along each status is, 0 to 1 (SPEC 8c).
  progressWeights: z.object({
    idea: z.number().min(0).max(1),
    demo: z.number().min(0).max(1),
    'in production': z.number().min(0).max(1),
    mixing: z.number().min(0).max(1),
    finished: z.number().min(0).max(1)
  }),
  // Saves less than this many hours apart are one work session (SPEC 7c).
  sessionGapHours: z.number().min(0.5).max(24),
  staleness: z
    .object({ amberDays: z.number().int().min(1), redDays: z.number().int().min(1) })
    .refine((s) => s.amberDays < s.redDays, { message: 'amber days must be less than red days' }),
  excitementScale: z.array(ExcitementLevelSchema).length(5),
  savedFilters: z.array(z.object({ name: z.string().min(1), filter: z.record(z.unknown()) })),
  activeSession: z
    .object({ songId: z.string(), sessionId: z.string(), startedAt: z.string() })
    .nullable(),
  songCache: z.record(SongCacheEntrySchema),
  songFlags: z.record(SongFlagsSchema),
  pendingSidecarEdits: z.array(
    z.object({ songId: z.string(), op: z.string(), from: z.string(), to: z.string().nullable() })
  )
})

export type Root = z.infer<typeof RootSchema>
export type ExcitementLevel = z.infer<typeof ExcitementLevelSchema>
export type AppState = z.infer<typeof AppStateSchema>
export type SongCacheEntry = z.infer<typeof SongCacheEntrySchema>

// The part of app state edited from the Settings view (SPEC section 9, view 7).
export const SETTINGS_KEYS = [
  'roots',
  'focusCap',
  'abletonAppName',
  'allowedExternalRoots',
  'bounceFolderNames',
  'inboxPaths',
  'inbox',
  'staleness',
  'excitementScale'
] as const

export const SettingsPatchSchema = AppStateSchema.pick({
  roots: true,
  focusCap: true,
  abletonAppName: true,
  allowedExternalRoots: true,
  bounceFolderNames: true,
  inboxPaths: true,
  inbox: true,
  staleness: true,
  excitementScale: true
})
  .partial()
  .strict()

export type Settings = Pick<AppState, (typeof SETTINGS_KEYS)[number]>
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>
