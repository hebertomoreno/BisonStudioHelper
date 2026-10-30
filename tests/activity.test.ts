import { mkdir, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ActivityStore, dropBulkCopies, findSaves, parseBackupName, toSessions, type FoundSave } from '../src/main/activity'
import { removeDir, tempDir } from './fixtures'

let dir: string
const local = (y: number, mo: number, d: number, h: number, mi: number, s = 0): number =>
  new Date(y, mo - 1, d, h, mi, s).getTime()

beforeEach(async () => {
  dir = await tempDir('finisher-activity-')
})

afterEach(async () => {
  await removeDir(dir)
})

describe('save history', () => {
  it('reads backup names as local times', () => {
    expect(parseBackupName('WeAreNotToBlame [2026-10-08 174115].als')).toEqual({
      set: 'WeAreNotToBlame',
      at: local(2026, 10, 8, 17, 41, 15)
    })
    expect(parseBackupName('Song.als')).toBeNull()
    expect(parseBackupName('._WeAreNotToBlame [2026-10-08 174115].als')).toMatchObject({ set: '._WeAreNotToBlame' })
  })

  it('finds a save per backup name, per backup mtime, and per set mtime', async () => {
    const project = join(dir, 'Song Project')
    await mkdir(join(project, 'Backup'), { recursive: true })
    const backup = join(project, 'Backup/Song [2026-10-08 183047].als')
    await writeFile(backup, 'x')
    await utimes(backup, local(2026, 10, 8, 17, 41) / 1000, local(2026, 10, 8, 17, 41) / 1000)
    await writeFile(join(project, 'Backup/._Song [2026-10-08 183047].als'), 'x')

    const saves = await findSaves(project, [{ name: 'Song.als', mtimeMs: local(2026, 10, 19, 20, 49), size: 1 }])
    expect(saves.map((s) => [s.source, new Date(s.at).getHours(), new Date(s.at).getMinutes()]).sort()).toEqual([
      ['backup', 18, 30],
      ['mtime', 17, 41],
      ['mtime', 20, 49]
    ])
  })

  it('ignores mtimes shared by many projects in the same minute, but never backup names', () => {
    const at = local(2026, 7, 9, 12, 0)
    const byProject = new Map<string, FoundSave[]>()
    for (const p of ['a', 'b', 'c', 'd']) byProject.set(p, [{ at, set: p, source: 'mtime' }])
    byProject.get('a')!.push({ at, set: 'a', source: 'backup' }, { at: at - 86_400_000, set: 'a', source: 'mtime' })
    dropBulkCopies(byProject)
    expect(byProject.get('a')!.map((s) => s.source)).toEqual(['backup', 'mtime'])
    expect(byProject.get('d')).toEqual([])
  })

  it('merges without duplicating saves of the same set within 2 seconds', async () => {
    const store = new ActivityStore(join(dir, 'activity.json'))
    await store.load()
    const at = local(2026, 10, 19, 20, 49, 29)
    expect(store.merge('song', [{ at, set: 'Song', source: 'backup' }])).toBe(true)
    expect(store.merge('song', [{ at: at + 1000, set: 'Song', source: 'mtime' }])).toBe(false)
    expect(store.merge('song', [{ at: at + 1000, set: 'Song Rec', source: 'mtime' }])).toBe(true)
    await store.persist()
    const reloaded = new ActivityStore(join(dir, 'activity.json'))
    await reloaded.load()
    expect(reloaded.saves('song')).toHaveLength(2)
  })
})

describe('toSessions', () => {
  const save = (at: number) => ({ at: new Date(at).toISOString(), set: 'Song', source: 'backup' as const })

  it('groups saves less than the gap apart, and lets an Open in Live session absorb them', () => {
    const day1 = local(2026, 10, 8, 17, 0)
    const saves = [save(day1), save(day1 + 50 * 60_000), save(day1 + 110 * 60_000), save(day1 + 26 * 3_600_000)]
    const sessions = toSessions(saves, [], 3)
    expect(sessions.map((s) => s.saveCount)).toEqual([3, 1])
    expect(Date.parse(sessions[0].end) - Date.parse(sessions[0].start)).toBe(110 * 60_000)

    const explicit = [{ startedAt: new Date(day1 - 30 * 60_000).toISOString(), endedAt: new Date(day1 + 2 * 3_600_000).toISOString() }]
    const merged = toSessions(saves, explicit, 3)
    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({ explicit: true, saveCount: 3, start: explicit[0].startedAt })
  })
})
