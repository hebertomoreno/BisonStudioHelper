// IPC contract between main and renderer. The preload exposes FinisherApi as window.finisher.
import type { Settings, SettingsPatch } from './schema'
import type { Lane, LibrarySnapshot, QueueSort, SetLaneResult } from './songs'

export const IPC = {
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  pickFolder: 'dialog:pickFolder',
  getPathStatus: 'fs:pathStatus',
  getLibrary: 'library:get',
  rescan: 'library:rescan',
  setLane: 'library:setLane',
  reorder: 'library:reorder',
  setQueueSort: 'library:setQueueSort',
  addSongToRelease: 'release:addSong',
  setTitle: 'song:setTitle',
  pickReleaseArt: 'release:pickArt',
  // main → renderer push
  libraryChanged: 'library:changed'
} as const

export interface SettingsResult {
  settings: Settings
  // Problems found while loading state.json (e.g. a field reset to its default).
  warnings: string[]
}

export type UpdateSettingsResult =
  | { ok: true; settings: Settings }
  | { ok: false; errors: string[] }

export interface PickFolderOptions {
  title?: string
  defaultPath?: string
}

export type PathStatus = 'ok' | 'missing' | 'not-a-folder'

export interface FinisherApi {
  getSettings(): Promise<SettingsResult>
  updateSettings(patch: SettingsPatch): Promise<UpdateSettingsResult>
  pickFolder(options?: PickFolderOptions): Promise<string | null>
  getPathStatus(paths: string[]): Promise<Record<string, PathStatus>>

  getLibrary(): Promise<LibrarySnapshot>
  rescan(): Promise<void>
  setLane(ids: string[], lane: Lane, bumpToQueue?: string[]): Promise<SetLaneResult>
  reorder(lane: 'focus' | 'queue', ids: string[]): Promise<void>
  setQueueSort(sort: QueueSort): Promise<void>
  addSongToRelease(songId: string, releaseId: string): Promise<void>
  setTitle(songId: string, title: string): Promise<void>
  // Opens an image picker and stores the chosen file as the release's cover. False if cancelled.
  pickReleaseArt(releaseId: string): Promise<boolean>
  // Returns an unsubscribe function.
  onLibraryChanged(listener: (snapshot: LibrarySnapshot) => void): () => void
}
