// Shape of .finisher.json (SPEC section 2). Unknown keys are kept, so a newer app version's data survives a rewrite.
import { z } from 'zod'

export const STATUSES = ['idea', 'demo', 'in production', 'mixing', 'finished'] as const
export const StatusSchema = z.enum(STATUSES)
export type Status = z.infer<typeof StatusSchema>

export const SessionSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  notes: z.string(),
  next: z.string()
})

export const SidecarSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    title: z.string(),
    aliases: z.array(z.string()).default([]),
    status: StatusSchema,
    statusHistory: z.array(z.object({ status: StatusSchema, at: z.string() })).default([]),
    excitement: z.number().int().min(1).max(5).nullable().default(null),
    excitementHistory: z
      .array(z.object({ value: z.number().int().min(1).max(5), at: z.string(), note: z.string().nullable() }))
      .default([]),
    sessions: z.array(SessionSchema).default([]),
    tasks: z
      .array(
        z.object({
          id: z.string(),
          text: z.string(),
          done: z.boolean(),
          createdAt: z.string(),
          doneAt: z.string().nullable()
        })
      )
      .default([]),
    mainAls: z.string().nullable().default(null),
    // Filled in by the collect check (step 6).
    collect: z.object({}).passthrough().nullable().default(null),
    pinnedBounce: z.string().nullable().default(null),
    linkedBounces: z.array(z.object({ path: z.string(), linkedAt: z.string() })).default([]),
    copiedBounces: z.array(z.object({}).passthrough()).default([]),
    releases: z.array(z.string()).default([]),
    primaryRelease: z.string().nullable().default(null),
    releaseSource: z.enum(['folder', 'user']).nullable().default(null)
  })
  .passthrough()

export type Sidecar = z.infer<typeof SidecarSchema>
