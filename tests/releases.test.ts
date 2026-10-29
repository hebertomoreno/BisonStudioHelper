import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultReleases, fromLegacy, ReleaseStore } from '../src/main/releases'
import { StateStore } from '../src/main/state'
import { removeDir, tempDir } from './fixtures'

let dir: string

beforeEach(async () => {
  dir = await tempDir('finisher-releases-')
})

afterEach(async () => {
  await removeDir(dir)
})

describe('ReleaseStore', () => {
  it('seeds the four Feather releases pointing at their folders', async () => {
    const store = new ReleaseStore(join(dir, 'releases.json'))
    await store.load(() => defaultReleases())
    const written = JSON.parse(await readFile(join(dir, 'releases.json'), 'utf8'))
    expect(written.releases.map((r: { name: string }) => r.name)).toEqual([
      'YearOfTheBrownBear',
      'Filosofolk',
      'The Forest',
      'Emi Folder',
      'Nikolas Murdock Demo 2021'
    ])
    expect(store.all()[1].folder).toEqual({ rootPath: '/Volumes/Feather/Songs', path: 'Projects/Filosofolk' })
    expect(store.all()[4]).toMatchObject({ folder: null, released: true })
  })

  it('migrates releases, folder links and tracklists from an older state.json', async () => {
    await writeFile(
      join(dir, 'state.json'),
      JSON.stringify({
        releases: [
          { name: 'Filosofolk', type: 'other', released: false, targetDate: '2027-03-01', art: 'x.png', createdAt: 'c' },
          { name: 'Old EP', type: 'EP', released: true, targetDate: null, createdAt: 'c' }
        ],
        roots: [{ path: '/Volumes/Feather/Songs', foldersPath: 'Projects', folders: { Filosofolk: { release: 'Filosofolk' } } }],
        tracklists: { Filosofolk: ['a', 'b'] }
      })
    )
    const state = new StateStore(join(dir, 'state.json'), '/Users/tester')
    await state.load()
    const releases = new ReleaseStore(join(dir, 'releases.json'))
    await releases.load(() => fromLegacy(state.legacyReleases!))

    expect(releases.all()[0]).toMatchObject({
      name: 'Filosofolk',
      targetDate: '2027-03-01',
      art: 'x.png',
      order: ['a', 'b'],
      folder: { rootPath: '/Volumes/Feather/Songs', path: 'Projects/Filosofolk' }
    })
    expect(releases.all()[1]).toMatchObject({ name: 'Old EP', folder: null, released: true })
  })

  it('moves an unreadable releases.json aside instead of overwriting it', async () => {
    await writeFile(join(dir, 'releases.json'), '{"schemaVersion":1,"releases":[{"name":""}]}')
    const store = new ReleaseStore(join(dir, 'releases.json'))
    await store.load(() => ({ schemaVersion: 1, releases: [] }))
    expect(store.warnings[0]).toMatch(/could not be read/)
    expect((await readdir(dir)).some((f) => f.startsWith('releases.json.corrupt-'))).toBe(true)
  })

  it('rejects folder paths that escape the root', async () => {
    const store = new ReleaseStore(join(dir, 'releases.json'))
    await store.load(() => defaultReleases())
    await expect(
      store.updateOne(store.all()[0].id, (r) => ({ ...r, folder: { rootPath: '/Volumes/Feather/Songs', path: '../x' } }))
    ).rejects.toThrow()
  })
})
