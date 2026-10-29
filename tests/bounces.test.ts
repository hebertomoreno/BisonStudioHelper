import { mkdir, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findBounces, playableFile, previewBounce } from '../src/main/bounces'
import { parseRange } from '../src/main/media'
import { makeProject, makeSymlink, removeDir, tempDir } from './fixtures'

const NAMES = ['Bounces', 'Exported Files']
let dir: string

async function audio(path: string, mtime = 1_700_000_000): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, 'audio')
  await utimes(path, mtime, mtime)
}

beforeEach(async () => {
  dir = await tempDir('finisher-bounces-')
})

afterEach(async () => {
  await removeDir(dir)
})

describe('findBounces', () => {
  it('reads bounce folders by any spelling, top level only, grouped by basename', async () => {
    const project = await makeProject(join(dir, 'Song Project'))
    await audio(join(project, 'ExportedFIles/Song v3.mp3'), 1_700_000_300)
    await audio(join(project, 'ExportedFIles/Song v3.wav'), 1_700_000_200)
    await audio(join(project, 'ExportedFIles/StemsForMixing/Kick.wav'))
    await audio(join(project, 'Bounces/Song v1.wav'), 1_700_000_100)
    await audio(join(project, 'Bounces/Song v1.wav.asd'))
    await audio(join(project, 'Bounces/._Song v1.wav'))

    const bounces = await findBounces(project, null, NAMES)
    expect(bounces.map((b) => b.name)).toEqual(['Song v3', 'Song v1'])
    expect(bounces[0].files.map((f) => f.format).sort()).toEqual(['mp3', 'wav'])
    expect(bounces[0]).toMatchObject({ location: 'bounces', mtimeMs: 1_700_000_300_000 })
  })

  it('counts loose audio in the project and its wrapper, and skips symlinks', async () => {
    const wrapper = join(dir, 'Massive')
    const project = await makeProject(join(wrapper, 'Massive Project'))
    await audio(join(project, 'Massive.mp3'))
    await audio(join(wrapper, 'Bounces/Massive final.m4a'))
    await audio(join(dir, 'elsewhere.mp3'))
    await makeSymlink(join(dir, 'elsewhere.mp3'), join(project, 'Linked.mp3'))

    const bounces = await findBounces(project, wrapper, NAMES)
    expect(bounces.map((b) => `${b.name} (${b.location})`).sort()).toEqual([
      'Massive (project)',
      'Massive final (bounces)'
    ])
  })

  it('prefers MP3, falls back to the newest bounce, and cannot play AIFF', async () => {
    const project = await makeProject(join(dir, 'Song Project'))
    await audio(join(project, 'Bounces/A.wav'), 1_700_000_100)
    await audio(join(project, 'Bounces/A.mp3'), 1_700_000_100)
    await audio(join(project, 'Bounces/B.aif'), 1_700_000_200)

    const bounces = await findBounces(project, null, NAMES)
    expect(previewBounce(bounces, null)!.name).toBe('B')
    expect(playableFile(previewBounce(bounces, null)!)).toBeNull()
    expect(previewBounce(bounces, 'A')!.name).toBe('A')
    expect(playableFile(previewBounce(bounces, 'A')!)!.format).toBe('mp3')
    // A pinned bounce that was deleted falls back to the newest.
    expect(previewBounce(bounces, 'Gone')!.name).toBe('B')
  })
})

describe('parseRange', () => {
  it('handles open, closed, suffix and bad ranges', () => {
    expect(parseRange(null, 100)).toBeNull()
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=100-', 100)).toBeNull()
    expect(parseRange('items=0-1', 100)).toBeNull()
  })
})
