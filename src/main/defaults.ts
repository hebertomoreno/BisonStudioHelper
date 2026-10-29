// Default app state for this user's machine (SPEC sections 0 and 2).
import { join } from 'node:path'
import type { AppState } from '../shared/schema'

// Releases are seeded separately, in releases.json (src/main/releases.ts).
export function defaultState(home: string): AppState {
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
        ]
      },
      {
        path: '/Volumes/Feather/Songs',
        label: 'Feather',
        maxDepth: 6,
        exclude: [],
        foldersPath: 'Projects'
      }
    ],
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
    progressWeights: { idea: 0, demo: 0.25, 'in production': 0.55, mixing: 0.8, finished: 1 },
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
    songFlags: {},
    pendingSidecarEdits: []
  }
}
