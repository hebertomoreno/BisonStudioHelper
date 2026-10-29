import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { extname, join } from 'node:path'
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { ZodError } from 'zod'
import { SettingsPatchSchema } from '../shared/schema'
import {
  IPC,
  type PathStatus,
  type PickFolderOptions,
  type SettingsResult,
  type UpdateSettingsResult
} from '../shared/ipc'
import type { Lane, QueueSort, SetLaneResult } from '../shared/songs'
import type { Library } from './library'
import type { ReleaseStore } from './releases'
import { formatZodError, pickSettings, type StateStore } from './state'

const LANES: Lane[] = ['focus', 'queue', 'shelf']
const QUEUE_SORTS: QueueSort[] = ['lastWorked', 'excitement', 'manual']
const ART_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif']
const MAX_ART_BYTES = 25 * 1024 * 1024

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

// Only answer IPC from our own renderer, never from a navigated-away or injected frame.
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? ''
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  return devUrl ? url.startsWith(devUrl) : url.startsWith('file://')
}

function handle<Args extends unknown[], Result>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => Promise<Result> | Result
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error(`Untrusted IPC sender for ${channel}`)
    return handler(event, ...(args as Args))
  })
}

export function registerIpc(
  store: StateStore,
  library: Library,
  releases: ReleaseStore,
  artDir: string,
  onSettingsSaved: () => void
): void {
  handle(IPC.getLibrary, () => library.snapshot())

  handle(IPC.rescan, () => library.scan())

  handle(IPC.setLane, (_event, ids: unknown, lane: unknown, bumpToQueue: unknown): Promise<SetLaneResult> => {
    if (!LANES.includes(lane as Lane)) throw new Error(`Unknown lane: ${String(lane)}`)
    return library.setLane(stringArray(ids), lane as Lane, stringArray(bumpToQueue))
  })

  handle(IPC.reorder, (_event, lane: unknown, ids: unknown) => {
    if (lane !== 'focus' && lane !== 'queue') throw new Error(`Cannot reorder lane: ${String(lane)}`)
    return library.reorder(lane, stringArray(ids))
  })

  handle(IPC.setQueueSort, (_event, sort: unknown) => {
    if (!QUEUE_SORTS.includes(sort as QueueSort)) throw new Error(`Unknown sort: ${String(sort)}`)
    return library.setQueueSort(sort as QueueSort)
  })

  handle(IPC.addSongToRelease, (_event, songId: unknown, releaseId: unknown) => {
    if (typeof songId !== 'string' || typeof releaseId !== 'string') throw new Error('Invalid song or release')
    return library.addSongToRelease(songId, releaseId)
  })

  handle(IPC.setTitle, (_event, songId: unknown, title: unknown) => {
    if (typeof songId !== 'string' || typeof title !== 'string') throw new Error('Invalid song or title')
    return library.setTitle(songId, title)
  })

  // Copies the chosen image into the app's art folder; project and release folders are never written.
  handle(IPC.pickReleaseArt, async (event, releaseId: unknown): Promise<boolean> => {
    const release = typeof releaseId === 'string' ? releases.find(releaseId) : undefined
    if (!release) throw new Error('Unknown release')
    const window = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      title: `Cover for ${release.name}`,
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ART_EXTENSIONS }]
    }
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    if (result.canceled || result.filePaths.length === 0) return false

    const source = result.filePaths[0]
    const ext = extname(source).slice(1).toLowerCase()
    if (!ART_EXTENSIONS.includes(ext)) throw new Error('Choose a JPEG, PNG, WebP or GIF image')
    if ((await fs.stat(source)).size > MAX_ART_BYTES) throw new Error('That image is over 25 MB')
    const name = `${randomUUID()}.${ext}`
    await fs.mkdir(artDir, { recursive: true })
    await fs.copyFile(source, join(artDir, name))
    const previous = await library.setReleaseArt(release.id, name)
    if (previous) await fs.rm(join(artDir, previous), { force: true })
    return true
  })

  handle(IPC.getSettings, (): SettingsResult => ({
    settings: pickSettings(store.get()),
    warnings: store.warnings
  }))

  handle(IPC.updateSettings, async (_event, patch: unknown): Promise<UpdateSettingsResult> => {
    const parsed = SettingsPatchSchema.safeParse(patch)
    if (!parsed.success) return { ok: false, errors: formatZodError(parsed.error) }
    try {
      const next = await store.update((current) => ({ ...current, ...parsed.data }))
      onSettingsSaved()
      return { ok: true, settings: pickSettings(next) }
    } catch (err) {
      if (err instanceof ZodError) return { ok: false, errors: formatZodError(err) }
      throw err
    }
  })

  handle(IPC.pickFolder, async (event, options?: PickFolderOptions): Promise<string | null> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      title: typeof options?.title === 'string' ? options.title : 'Choose a folder',
      defaultPath: typeof options?.defaultPath === 'string' ? options.defaultPath : undefined,
      properties: ['openDirectory', 'createDirectory']
    }
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  handle(IPC.getPathStatus, async (_event, paths: unknown): Promise<Record<string, PathStatus>> => {
    if (!Array.isArray(paths)) return {}
    const status: Record<string, PathStatus> = {}
    for (const p of paths.slice(0, 200)) {
      if (typeof p !== 'string' || !p.startsWith('/')) continue
      try {
        status[p] = (await fs.stat(p)).isDirectory() ? 'ok' : 'not-a-folder'
      } catch {
        status[p] = 'missing'
      }
    }
    return status
  })
}
