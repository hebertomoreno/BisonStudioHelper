import { cp, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Library } from '../src/main/library'
import { SelfWrites } from '../src/main/sidecar'
import { StateStore } from '../src/main/state'
import type { SongSummary } from '../src/shared/songs'
import { makeProject, removeDir, root, tempDir } from './fixtures'

let dir: string
let songsA: string
let songsB: string
let store: StateStore
let library: Library

async function setup(): Promise<void> {
  store = new StateStore(join(dir, 'state.json'), '/Users/tester')
  await store.load()
  await store.update((s) => ({
    ...s,
    roots: [root(songsA, { label: 'Documents' }), root(songsB, { label: 'Feather', foldersPath: 'Projects' })]
  }))
  library = new Library(store, new SelfWrites(), () => {})
}

const byTitle = (title: string): SongSummary | undefined =>
  library.snapshot().songs.find((s) => s.title === title)

async function sidecarOf(projectPath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(projectPath, '.finisher.json'), 'utf8'))
}

beforeEach(async () => {
  dir = await tempDir('finisher-lib-')
  songsA = join(dir, 'Documents/Songs')
  songsB = join(dir, 'Feather/Songs')
  await makeProject(join(songsA, 'Earth Project'))
  await makeProject(join(songsB, 'Projects/Rough Ideas/LoFi1 Project'))
  await setup()
})

afterEach(async () => {
  await removeDir(dir)
})

describe('Library.scan', () => {
  it('creates sidecars, shelves new songs, and fills songCache', async () => {
    await library.scan()

    const earth = byTitle('Earth')!
    expect(earth).toMatchObject({ rootLabel: 'Documents', folder: null, lane: 'shelf', status: 'idea', availability: 'ok' })
    expect(byTitle('LoFi1')).toMatchObject({ rootLabel: 'Feather', folder: 'Rough Ideas' })

    const sidecar = await sidecarOf(join(songsA, 'Earth Project'))
    expect(sidecar).toMatchObject({ schemaVersion: 1, id: earth.id, title: 'Earth', status: 'idea' })
    expect(store.get().songCache[earth.id].path).toBe(join(songsA, 'Earth Project'))
    // The first scan imports everything, so nothing is tagged New.
    expect(earth.isNew).toBe(false)
  })

  it('tags songs found after the first scan as New', async () => {
    await library.scan()
    await makeProject(join(songsA, 'Hospital Project'))
    await library.scan()

    expect(byTitle('Hospital')?.isNew).toBe(true)
    expect(byTitle('Earth')?.isNew).toBe(false)
  })

  it('keeps the id when a project folder is renamed or moved to another root', async () => {
    await library.scan()
    const id = byTitle('Earth')!.id
    await rename(join(songsA, 'Earth Project'), join(songsB, 'Projects/Rough Ideas/Earth Project'))
    await library.scan()

    const songs = library.snapshot().songs.filter((s) => s.title === 'Earth')
    expect(songs).toHaveLength(1)
    expect(songs[0]).toMatchObject({ id, rootLabel: 'Feather', folder: 'Rough Ideas', availability: 'ok' })
  })

  it('gives a duplicated project a new id and keeps the original on the known folder', async () => {
    await library.scan()
    const original = byTitle('Earth')!
    await cp(join(songsA, 'Earth Project'), join(songsA, 'Earth Copy Project'), { recursive: true })
    await library.scan()

    const earths = library.snapshot().songs.filter((s) => s.title === 'Earth')
    expect(earths).toHaveLength(2)
    const copy = earths.find((s) => s.id !== original.id)!
    expect(copy.path).toBe(join(songsA, 'Earth Copy Project'))
    expect(copy.duplicateOf).toBe('Earth')
    expect((await sidecarOf(copy.path)).id).toBe(copy.id)
    expect((await sidecarOf(original.path)).id).toBe(original.id)
  })

  it('leaves an unreadable sidecar untouched and lists the song as invalid', async () => {
    const bad = await makeProject(join(songsA, 'Broken Project'))
    await writeFile(join(bad, '.finisher.json'), '{ nope')
    await library.scan()

    expect(byTitle('Broken')).toMatchObject({ availability: 'invalid-sidecar', lane: 'shelf' })
    expect(await readFile(join(bad, '.finisher.json'), 'utf8')).toBe('{ nope')
    expect(library.snapshot().warnings.some((w) => w.includes('Broken Project'))).toBe(true)
  })

  it('shows songs on an unmounted root from songCache', async () => {
    await library.scan()
    await rename(join(dir, 'Feather'), join(dir, 'Feather-unplugged'))
    await library.scan()

    expect(byTitle('LoFi1')).toMatchObject({ availability: 'drive-not-connected', folder: 'Rough Ideas' })
    expect(library.snapshot().roots.find((r) => r.label === 'Feather')?.mounted).toBe(false)
  })

  it('marks a song not found when its root is mounted but the folder is gone', async () => {
    await library.scan()
    await removeDir(join(songsA, 'Earth Project'))
    await library.scan()

    expect(byTitle('Earth')?.availability).toBe('not-found')
  })
})

describe('Library lanes', () => {
  beforeEach(async () => {
    for (const name of ['B', 'C', 'D']) await makeProject(join(songsA, `${name} Project`))
    await library.scan()
  })

  const id = (title: string): string => byTitle(title)!.id

  it('moves songs between lanes and keeps manual order', async () => {
    await library.setLane([id('Earth'), id('B')], 'focus')
    await library.setLane([id('C')], 'queue')
    await library.reorder('focus', [id('B'), id('Earth')])

    const snap = library.snapshot()
    expect(snap.order.focus).toEqual([id('B'), id('Earth')])
    expect(snap.order.queue).toEqual([id('C')])
    expect(byTitle('C')?.lane).toBe('queue')
  })

  it('refuses to go over the Focus cap unless songs are bumped to Queue', async () => {
    await library.setLane([id('Earth'), id('B'), id('C')], 'focus')

    const refused = await library.setLane([id('D')], 'focus')
    expect(refused).toEqual({ ok: false, reason: 'focus-full', focusCap: 3, mustRemove: 1 })
    expect(byTitle('D')?.lane).toBe('shelf')

    expect(await library.setLane([id('D')], 'focus', [id('Earth')])).toEqual({ ok: true })
    expect(byTitle('Earth')?.lane).toBe('queue')
    expect(byTitle('D')?.lane).toBe('focus')
    expect(library.snapshot().order.queue).toEqual([id('Earth')])
  })

  it('clears the New tag when a song leaves the Shelf', async () => {
    await makeProject(join(songsA, 'Fresh Project'))
    await library.scan()
    expect(byTitle('Fresh')?.isNew).toBe(true)

    await library.setLane([id('Fresh')], 'queue')
    expect(byTitle('Fresh')?.isNew).toBe(false)
  })
})
