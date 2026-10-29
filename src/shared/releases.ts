// Shape of releases.json (SPEC section 8b): the release database. Releases point at folders;
// folders and sidecars know nothing about releases.
import { z } from 'zod'

export const ReleaseFolderSchema = z.object({
  // The song root the folder is in, e.g. /Volumes/Feather/Songs.
  rootPath: z.string().refine((p) => p.startsWith('/'), { message: 'must be an absolute path' }),
  // Folder path relative to the root, e.g. "Projects/Filosofolk".
  path: z
    .string()
    .trim()
    .min(1)
    .refine((p) => !p.startsWith('/') && !p.split('/').includes('..'), { message: 'must be a relative path' })
})

export const ReleaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  type: z.enum(['single', 'EP', 'album', 'other']),
  // The release is out, so it is old.
  released: z.boolean(),
  // Prospective release date, YYYY-MM-DD.
  targetDate: z.string().nullable(),
  // Cover image file name inside userData/art.
  art: z.string().nullable(),
  // Every song under this folder belongs to the release, except `excluded`.
  folder: ReleaseFolderSchema.nullable(),
  // Songs from outside the folder that are on the release.
  added: z.array(z.string()),
  // Songs inside the folder that are not on the release (sketches, old versions).
  excluded: z.array(z.string()),
  // How many tracks the release is meant to have; missing ones count as not started (SPEC 8c).
  plannedTracks: z.number().int().min(1).nullable().default(null),
  // Tracklist order as song ids. Members missing from it go last.
  order: z.array(z.string()),
  createdAt: z.string()
})

export const ReleasesFileSchema = z.object({
  schemaVersion: z.literal(1),
  releases: z.array(ReleaseSchema)
})

export type ReleaseFolder = z.infer<typeof ReleaseFolderSchema>
export type Release = z.infer<typeof ReleaseSchema>
export type ReleasesFile = z.infer<typeof ReleasesFileSchema>
