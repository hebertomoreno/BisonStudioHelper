// Default app state for this user's machine (SPEC sections 0 and 2).
import { join } from 'node:path'
import type { AppState, Release } from '../shared/schema'

function seedRelease(name: string, type: Release['type'], released: boolean, createdAt: string): Release {
  return { name, type, released, targetDate: null, createdAt }
}

export function defaultState(home: string, now: Date = new Date()): AppState {
  const createdAt = now.toISOString()
  const linkedFolders = ['YearOfTheBrownBear', 'Filosofolk', 'The Forest', 'Emi Folder']

  return {
    schemaVersion: 1,
    roots: [
      {
        path: join(home, 'Documents/Songs'),
        label: 'Documents',
        maxDepth: 6,
        exclude: [
          'Samples',
          '_Organized_By_Year',
          '_Organized_By_Year_Fixed',
          'MaxForLive',
          'Exported Songs (2019-2020)',
          'Nikolas Murdock Demo 2021'
        ],
        folders: {}
      },
      {
        path: '/Volumes/Feather/Songs',
        label: 'Feather',
        maxDepth: 6,
        exclude: [],
        foldersPath: 'Projects',
        folders: Object.fromEntries(linkedFolders.map((name) => [name, { release: name }]))
      }
    ],
    releases: [
      ...linkedFolders.map((name) => seedRelease(name, 'other', false, createdAt)),
      seedRelease('Nikolas Murdock Demo 2021', 'EP', true, createdAt)
    ],
    tracklists: {},
    focusCap: 3,
    lanes: {},
    order: { focus: [], queue: [] },
    queueSort: 'lastWorked',
    abletonAppName: 'Ableton Live 12 Suite',
    allowedExternalRoots: [
      '/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Core Library',
      join(home, 'Music/Ableton/User Library'),
      join(home, 'Music/Ableton/Factory Packs')
    ],
    bounceFolderNames: ['Bounces', 'Exported Files'],
    inboxPaths: [
      join(home, 'Library/Mobile Documents/com~apple~CloudDocs/Shared Bounces'),
      '/Volumes/Feather/Bounces'
    ],
    inbox: { ignored: [], matchThreshold: 60 },
    staleness: { amberDays: 7, redDays: 21 },
    excitementScale: [
      { value: 1, emoji: '😐', label: 'Not feeling it' },
      { value: 2, emoji: '🙂', label: 'Has something' },
      { value: 3, emoji: '😊', label: 'Worth working on' },
      { value: 4, emoji: '😃', label: 'Excited about it' },
      { value: 5, emoji: '🤩', label: 'Top priority' }
    ],
    savedFilters: [],
    activeSession: null,
    songCache: {},
    pendingSidecarEdits: []
  }
}
