import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsPatchSchema } from '../src/shared/schema'
import { StateStore } from '../src/main/state'

const HOME = '/Users/tester'
let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'finisher-state-'))
  file = join(dir, 'state.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('StateStore', () => {
  it('creates state.json with the defaults when it does not exist', async () => {
    const store = new StateStore(file, HOME)
    await store.load()

    const written = JSON.parse(await readFile(file, 'utf8'))
    expect(written.roots.map((r: { label: string }) => r.label)).toEqual(['Documents', 'Feather'])
    expect(written.roots[0].path).toBe('/Users/tester/Documents/Songs')
    expect(written.roots[1].foldersPath).toBe('Projects')
    // Releases live in releases.json.
    expect(written.releases).toBeUndefined()
    expect(store.warnings).toEqual([])
  })

  it('resets only the invalid field and keeps the rest', async () => {
    await writeFile(file, JSON.stringify({ focusCap: 5, staleness: { amberDays: 30, redDays: 10 } }))
    const store = new StateStore(file, HOME)
    await store.load()

    expect(store.get().focusCap).toBe(5)
    expect(store.get().staleness).toEqual({ amberDays: 7, redDays: 21 })
    expect(store.warnings).toEqual(['staleness in state.json was invalid and was reset to its default'])
  })

  it('moves a corrupt state.json aside and starts from defaults', async () => {
    await writeFile(file, '{ not json')
    const store = new StateStore(file, HOME)
    await store.load()

    const files = await readdir(dir)
    expect(files.some((f) => f.startsWith('state.json.corrupt-'))).toBe(true)
    expect(store.get().focusCap).toBe(3)
    expect(store.warnings).toHaveLength(1)
  })

  it('saves valid updates atomically and rejects invalid ones', async () => {
    const store = new StateStore(file, HOME)
    await store.load()

    await store.update((s) => ({ ...s, focusCap: 4 }))
    expect(JSON.parse(await readFile(file, 'utf8')).focusCap).toBe(4)
    expect(await readdir(dir)).not.toContain('state.json.tmp')

    await expect(store.update((s) => ({ ...s, focusCap: 0 }))).rejects.toThrow()
    expect(store.get().focusCap).toBe(4)
    expect(JSON.parse(await readFile(file, 'utf8')).focusCap).toBe(4)
  })
})

describe('SettingsPatchSchema', () => {
  it('rejects keys that are not settings', () => {
    expect(SettingsPatchSchema.safeParse({ lanes: {} }).success).toBe(false)
  })

  it('rejects relative root paths', () => {
    const result = SettingsPatchSchema.safeParse({
      roots: [{ path: 'Songs', label: 'Songs', maxDepth: 6, exclude: [] }]
    })
    expect(result.success).toBe(false)
  })
})
