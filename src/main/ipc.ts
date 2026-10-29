import { promises as fs } from 'node:fs'
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
import { formatZodError, pickSettings, type StateStore } from './state'

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

export function registerIpc(store: StateStore): void {
  handle(IPC.getSettings, (): SettingsResult => ({
    settings: pickSettings(store.get()),
    warnings: store.warnings
  }))

  handle(IPC.updateSettings, async (_event, patch: unknown): Promise<UpdateSettingsResult> => {
    const parsed = SettingsPatchSchema.safeParse(patch)
    if (!parsed.success) return { ok: false, errors: formatZodError(parsed.error) }
    try {
      const next = await store.update((current) => ({ ...current, ...parsed.data }))
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
