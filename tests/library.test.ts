import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Library, releaseProgress } from '../src/main/library'
import { ActivityStore } from '../src/main/activity'
import { ReleaseStore } from '../src/main/releases'
import { SelfWrites } from '../src/main/sidecar'
import { StateStore } from '../src/main/state'
import type { SongSummary } from '../src/shared/songs'
import { makeProject, removeDir, root, tempDir } from './fixtures'

let dir: string
let songsA: string
let songsB: string
let store: StateStore
let releases: ReleaseStore
let library: Library

async function setup(): Promise<void> {
  store = new StateStore(join(dir, 'state.json'), '/Users/tester')
  await store.load()
  await store.update((s) => ({
    ...s,
    roots: [root(songsA, { label: 'Documents' }), root(songsB, { label: 'Feather', foldersPath: 'Projects' })]
  }))
  releases = new ReleaseStore(join(dir, 'releases.json'))
  await releases.load(() => ({ schemaVersion: 1, releases: [] }))
  library = new Library(store, releases, new ActivityStore(join(dir, 'activity.json')), new SelfWrites(), () => {})
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

describe('releases and bounces', () => {
  it('takes membership from releases.json: the folder, minus excluded, plus added', async () => {
    const release = (name: string, extra: object = {}) => ({
      id: name,
      name,
      type: 'other' as const,
      released: false,
      targetDate: null,
      art: null,
      folder: null,
      added: [],
      excluded: [],
      plannedTracks: null,
      order: [],
      createdAt: '2026-10-29T00:00:00.000Z',
      ...extra
    })
    await makeProject(join(songsB, 'Projects/Rough Ideas/Sketch Project'))
    await releases.update(() => [
      release('Filosofolk', { folder: { rootPath: songsB, path: 'Projects/Rough Ideas' } }),
      release('The Forest')
    ])
    await library.scan()
    const sketch = byTitle('Sketch')!
    await releases.updateOne('Filosofolk', (r) => ({ ...r, excluded: [sketch.id] }))

    expect(byTitle('LoFi1')!.releases).toEqual([
      { id: 'Filosofolk', name: 'Filosofolk', fromFolder: true, released: false, artUrl: null }
    ])
    expect(byTitle('Sketch')!.releases).toEqual([])
    expect(byTitle('Earth')!.releases).toEqual([])

    await library.addSongToRelease(byTitle('Earth')!.id, 'The Forest')
    await library.addSongToRelease(sketch.id, 'Filosofolk')
    expect(byTitle('Earth')!.releases).toMatchObject([{ name: 'The Forest', fromFolder: false }])
    expect(byTitle('Sketch')!.releases).toMatchObject([{ name: 'Filosofolk', fromFolder: true }])
    // Release data never goes into the song's folder.
    expect(await sidecarOf(join(songsA, 'Earth Project'))).not.toHaveProperty('releases')
    expect(releases.find('Filosofolk')).toMatchObject({ excluded: [], added: [] })
    await expect(library.addSongToRelease(byTitle('Earth')!.id, 'Nope')).rejects.toThrow('Unknown release')

    expect(await library.setReleaseArt('The Forest', 'a.png')).toBeNull()
    expect(byTitle('Earth')!.releases[0].artUrl).toBe('art://file/a.png')
    expect(await library.setReleaseArt('The Forest', 'b.png')).toBe('a.png')
  })

  it('exposes the newest playable bounce and resolves only scanned files', async () => {
    const project = join(songsA, 'Earth Project')
    await mkdir(join(project, 'Bounces'), { recursive: true })
    await writeFile(join(project, 'Bounces/Earth v2.mp3'), 'audio')
    await library.scan()

    const earth = byTitle('Earth')!
    expect(earth.bounceCount).toBe(1)
    expect(earth.preview).toMatchObject({ name: 'Earth v2', format: 'mp3' })
    const id = earth.preview!.url!.replace('bounce://file/', '')
    expect(library.bounceFilePath(id)).toBe(join(project, 'Bounces/Earth v2.mp3'))
    expect(library.bounceFilePath('not-a-real-id')).toBeNull()
    expect(byTitle('LoFi1')!.preview).toBeNull()
  })

  it('renames a song in its sidecar only, and reports its set name', async () => {
    await library.scan()
    const earth = byTitle('Earth')!
    expect(earth.setName).toBe('Song')

    await library.setTitle(earth.id, '  Planet Earth ')
    expect(byTitle('Planet Earth')).toMatchObject({ id: earth.id, setName: 'Song', path: join(songsA, 'Earth Project') })
    expect(await sidecarOf(join(songsA, 'Earth Project'))).toMatchObject({ title: 'Planet Earth' })
    expect(store.get().songCache[earth.id].title).toBe('Planet Earth')
    await expect(library.setTitle(earth.id, '   ')).rejects.toThrow('1 to 200')
  })

  it('weighs songs by status and counts planned tracks that do not exist yet', async () => {
    await library.scan()
    expect(byTitle('Earth')!.progress).toBe(0)
    const song = (status: SongSummary['status'], progress: number): SongSummary =>
      ({ ...byTitle('Earth')!, status, progress }) as SongSummary
    const members = [song('mixing', 0.8), song('finished', 1), song('demo', 0.25)]
    expect(releaseProgress(members, null)).toMatchObject({
      songCount: 3,
      byStatus: { mixing: 1, finished: 1, demo: 1 }
    })
    expect(releaseProgress(members, null).value).toBeCloseTo(0.6833, 3)
    expect(releaseProgress(members, 5).value).toBeCloseTo(0.41, 3)
    expect(releaseProgress([], null).value).toBe(0)
  })

  it('records status and excitement changes in the sidecar history', async () => {
    await library.scan()
    const id = byTitle('Earth')!.id
    await library.setStatus(id, 'mixing')
    await library.setStatus(id, 'mixing')
    await library.setExcitement(id, 4, '  chorus works ')
    await expect(library.setExcitement(id, 6)).rejects.toThrow('1 to 5')

    const sidecar = await sidecarOf(join(songsA, 'Earth Project'))
    expect((sidecar.statusHistory as { status: string }[]).map((h) => h.status)).toEqual(['idea', 'mixing'])
    expect(sidecar.excitementHistory).toMatchObject([{ value: 4, note: 'chorus works' }])
    expect(byTitle('Earth')).toMatchObject({ status: 'mixing', excitement: 4, progress: 0.8 })
    expect(byTitle('Earth')!.statusSince).toBe((sidecar.statusHistory as { at: string }[])[1].at)
    expect(store.get().songCache[id]).toMatchObject({ status: 'mixing', excitement: 4 })
  })

  it('counts work sessions from Live backups, overall and in the current status', async () => {
    const project = join(songsA, 'Earth Project')
    await mkdir(join(project, 'Backup'), { recursive: true })
    for (const name of ['Song [2026-09-01 101500].als', 'Song [2026-09-01 113000].als', 'Song [2026-10-05 200000].als']) {
      await writeFile(join(project, 'Backup', name), 'x')
    }
    await library.scan()
    const id = byTitle('Earth')!.id
    // The set's own mtime (2023) and the backups' mtimes (now) are saves too.
    expect(byTitle('Earth')!.sessions.count).toBe(4)

    await library.setStatus(id, 'mixing')
    await writeFile(join(project, 'Backup', 'Song [2099-01-01 120000].als'), 'x')
    await library.scan()
    expect(byTitle('Earth')!.sessions).toMatchObject({ count: 5, inStatus: 2 })
  })
})
