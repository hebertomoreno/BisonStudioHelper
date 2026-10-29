// Reads and writes .finisher.json files (SPEC section 2).
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { SidecarSchema, type Sidecar } from '../shared/sidecar'
import { SIDECAR_NAME } from './scanner'
import { formatZodError, writeFileAtomic } from './state'

// ISO 8601 with the local offset, e.g. 2026-10-25T19:00:00-06:00.
export function localIso(date: Date = new Date()): string {
  const pad = (n: number): string => String(Math.floor(Math.abs(n))).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(offset / 60)}:${pad(offset % 60)}`
  )
}

export function defaultTitle(projectPath: string): string {
  return basename(projectPath).replace(/ Project$/, '')
}

export type ReadSidecarResult =
  | { kind: 'ok'; sidecar: Sidecar }
  | { kind: 'missing' }
  | { kind: 'invalid'; error: string }

export async function readSidecar(projectPath: string): Promise<ReadSidecarResult> {
  let raw: string
  try {
    raw = await fs.readFile(join(projectPath, SIDECAR_NAME), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    return { kind: 'invalid', error: `could not read: ${(err as NodeJS.ErrnoException).code ?? String(err)}` }
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { kind: 'invalid', error: 'not valid JSON' }
  }
  const parsed = SidecarSchema.safeParse(json)
  if (!parsed.success) return { kind: 'invalid', error: formatZodError(parsed.error).join('; ') }
  return { kind: 'ok', sidecar: parsed.data }
}

export function newSidecar(projectPath: string, now: Date = new Date()): Sidecar {
  const at = localIso(now)
  return SidecarSchema.parse({
    schemaVersion: 1,
    id: randomUUID(),
    title: defaultTitle(projectPath),
    status: 'idea',
    statusHistory: [{ status: 'idea', at }]
  })
}

// Remembers the app's own sidecar writes, so the watcher can ignore the events they cause.
export class SelfWrites {
  private writes = new Map<string, { size: number; mtimeMs: number; at: number }>()

  record(file: string, size: number, mtimeMs: number): void {
    this.writes.set(file, { size, mtimeMs, at: Date.now() })
  }

  async isOwnWrite(file: string): Promise<boolean> {
    const entry = this.writes.get(file)
    if (!entry) return false
    if (Date.now() - entry.at > 30_000) {
      this.writes.delete(file)
      return false
    }
    try {
      const stat = await fs.stat(file)
      return stat.size === entry.size && stat.mtimeMs === entry.mtimeMs
    } catch {
      return false
    }
  }
}

// Writes a sidecar for a newly discovered project. Fails with EEXIST instead of replacing a
// sidecar that appeared since the scan.
export async function createSidecarFile(projectPath: string, sidecar: Sidecar, selfWrites?: SelfWrites): Promise<void> {
  const file = join(projectPath, SIDECAR_NAME)
  await fs.writeFile(file, JSON.stringify(sidecar, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
  if (selfWrites) {
    const stat = await fs.stat(file)
    selfWrites.record(file, stat.size, stat.mtimeMs)
  }
}

export async function writeSidecar(projectPath: string, sidecar: Sidecar, selfWrites?: SelfWrites): Promise<void> {
  const file = join(projectPath, SIDECAR_NAME)
  await writeFileAtomic(file, JSON.stringify(sidecar, null, 2) + '\n')
  if (selfWrites) {
    const stat = await fs.stat(file)
    selfWrites.record(file, stat.size, stat.mtimeMs)
  }
}
