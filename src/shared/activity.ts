// Shape of activity.json: .als saves per song, the raw material for work sessions (SPEC 7c).
import { z } from 'zod'

export const SaveSchema = z.object({
  // ISO time of the save.
  at: z.string(),
  // Set name without .als, e.g. "WeAreNotToBlame".
  set: z.string(),
  // "backup" = from a Backup/ file name, never wrong; "mtime" = a file's modified time.
  source: z.enum(['backup', 'mtime'])
})

export const ActivityFileSchema = z.object({
  schemaVersion: z.literal(1),
  saves: z.record(z.array(SaveSchema))
})

export type Save = z.infer<typeof SaveSchema>
export type ActivityFile = z.infer<typeof ActivityFileSchema>

export interface WorkSession {
  start: string
  end: string
  saveCount: number
  // Started with Open in Live (has notes); otherwise inferred from saves.
  explicit: boolean
}
