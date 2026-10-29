import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverProjects } from '../src/main/scanner'
import { makeProject, makeSymlink, removeDir, root, tempDir } from './fixtures'

const BOUNCES = ['Bounces', 'Exported Files']
let dir: string

beforeEach(async () => {
  dir = await tempDir('finisher-scan-')
})

afterEach(async () => {
  await removeDir(dir)
})

const paths = (result: Awaited<ReturnType<typeof discoverProjects>>): string[] =>
  result.projects.map((p) => p.path.slice(dir.length + 1)).sort()

describe('discoverProjects', () => {
  it('finds projects at the root, in wrappers, and with names not ending in " Project"', async () => {
    await makeProject(join(dir, 'Earth Project'))
    await makeProject(join(dir, 'Valid Reasons/ValidReasons Project'))
    await makeProject(join(dir, 'Pure Conviction/DR-05/Pure Conviction'))

    expect(paths(await discoverProjects(root(dir), BOUNCES))).toEqual([
      'Earth Project',
      'Pure Conviction/DR-05/Pure Conviction',
      'Valid Reasons/ValidReasons Project'
    ])
  })

  it('needs both Ableton Project Info and a top-level .als', async () => {
    await mkdir(join(dir, 'No Als Project/Ableton Project Info'), { recursive: true })
    await mkdir(join(dir, 'No Info Project'), { recursive: true })
    await writeFile(join(dir, 'No Info Project/Song.als'), '')
    // AppleDouble files on exFAT look like .als files but are not.
    await mkdir(join(dir, 'AppleDouble Project/Ableton Project Info'), { recursive: true })
    await writeFile(join(dir, 'AppleDouble Project/._Song.als'), '')

    expect(paths(await discoverProjects(root(dir), BOUNCES))).toEqual([])
  })

  it('skips symlinks, Samples, Backup, bounce folders, hidden folders and excluded names', async () => {
    const real = await makeProject(join(dir, 'Real Project'))
    await mkdir(join(dir, '_Organized_By_Year_Fixed'))
    await makeSymlink(real, join(dir, '_Organized_By_Year_Fixed/Real Project'))
    await makeSymlink(join(dir, 'gone'), join(dir, 'Dangling Project'))
    await makeProject(join(dir, 'Samples/Pack/Loop Project'))
    await makeProject(join(dir, 'Real Project 2/Backup/Old Project'))
    await makeProject(join(dir, 'Song/ExportedFiles/Inside Project'))
    await makeProject(join(dir, '.Trashes/Trashed Project'))
    await makeProject(join(dir, 'MaxForLive/Device Project'))

    const result = await discoverProjects(root(dir, { exclude: ['MaxForLive'] }), BOUNCES)
    expect(paths(result)).toEqual(['Real Project'])
  })

  it('supports excludes given as a path relative to the root', async () => {
    await makeProject(join(dir, 'A/Old Versions/X Project'))
    await makeProject(join(dir, 'B/Old Versions/Y Project'))

    const result = await discoverProjects(root(dir, { exclude: ['A/Old Versions'] }), BOUNCES)
    expect(paths(result)).toEqual(['B/Old Versions/Y Project'])
  })

  it('stops descending inside a project and respects maxDepth', async () => {
    await makeProject(join(dir, 'Outer Project'))
    await makeProject(join(dir, 'Outer Project/Nested Project'))
    await makeProject(join(dir, 'a/b/c/Deep Project'))

    expect(paths(await discoverProjects(root(dir, { maxDepth: 3 }), BOUNCES))).toEqual(['Outer Project'])
    expect(paths(await discoverProjects(root(dir, { maxDepth: 4 }), BOUNCES))).toEqual([
      'Outer Project',
      'a/b/c/Deep Project'
    ])
  })

  it('picks the newest .als and notices an existing sidecar', async () => {
    const p = await makeProject(join(dir, 'Massive Project'), {
      'Massive.als': 1_700_000_000,
      'Massivewithanalog12.als': 1_710_000_000,
      'Another Idea.als': 1_600_000_000
    })
    await writeFile(join(p, '.finisher.json'), '{}')

    const [project] = (await discoverProjects(root(dir), BOUNCES)).projects
    expect(project.newestAls?.name).toBe('Massivewithanalog12.als')
    expect(project.alsFiles).toHaveLength(3)
    expect(project.hasSidecar).toBe(true)
  })

  it('assigns the first-level folder under foldersPath, at any depth', async () => {
    await makeProject(join(dir, 'Bouncy1 Project'))
    await makeProject(join(dir, 'Projects/Rough Ideas/HappyHour Project'))
    await makeProject(join(dir, 'Projects/ReallyHappy/Ableton Sessions/Old Versions/Valid Reasons/ValidReasons Project'))

    const result = await discoverProjects(root(dir, { foldersPath: 'Projects' }), BOUNCES)
    const byName = Object.fromEntries(result.projects.map((p) => [p.path.split('/').pop(), p.folder]))
    expect(byName).toEqual({
      'Bouncy1 Project': null,
      'HappyHour Project': 'Rough Ideas',
      'ValidReasons Project': 'ReallyHappy'
    })
  })

  it('finds the wrapper folder that holds only one project', async () => {
    await makeProject(join(dir, 'Pure Conviction/DR-05/Pure Conviction'))
    await makeProject(join(dir, 'How Can I Miss You/HowCanIMissYou Project'))
    await makeProject(join(dir, 'How Can I Miss You/HowCanIMissYou2 Project'))
    await makeProject(join(dir, 'Earth Project'))
    await makeProject(join(dir, 'Projects/Rough Ideas/LoFi1 Project'))
    await makeProject(join(dir, 'Projects/Singles/GimmeTheSign/GimmeTheSignPostBobbing Project'))

    const result = await discoverProjects(root(dir, { foldersPath: 'Projects' }), BOUNCES)
    const wrappers = Object.fromEntries(
      result.projects.map((p) => [p.path.split('/').pop(), p.wrapperPath?.slice(dir.length + 1) ?? null])
    )
    expect(wrappers).toEqual({
      'Pure Conviction': 'Pure Conviction',
      'HowCanIMissYou Project': null,
      'HowCanIMissYou2 Project': null,
      'Earth Project': null,
      'LoFi1 Project': null,
      'GimmeTheSignPostBobbing Project': 'Projects/Singles/GimmeTheSign'
    })
  })

  it('reports a missing root as a warning instead of throwing', async () => {
    const result = await discoverProjects(root(join(dir, 'nope')), BOUNCES)
    expect(result.projects).toEqual([])
    expect(result.warnings).toHaveLength(1)
  })
})
