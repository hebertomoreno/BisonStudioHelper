// IPC contract between main and renderer. The preload exposes FinisherApi as window.finisher.
import type { Settings, SettingsPatch } from './schema'

export const IPC = {
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  pickFolder: 'dialog:pickFolder',
  getPathStatus: 'fs:pathStatus'
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
}
