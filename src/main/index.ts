import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import { IPC } from '../shared/ipc'
import { registerIpc } from './ipc'
import { Library } from './library'
import { SelfWrites } from './sidecar'
import { StateStore } from './state'
import { LibraryWatcher } from './watcher'

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Finisher',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => window.show())

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    window.loadURL(devUrl)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

// Lets development and tests run against a separate state.json instead of the real one.
if (process.env['FINISHER_USER_DATA']) app.setPath('userData', process.env['FINISHER_USER_DATA'])

// The renderer never navigates or opens windows; block both.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event) => event.preventDefault())
})

app.whenReady().then(async () => {
  const store = new StateStore(join(app.getPath('userData'), 'state.json'), homedir())
  try {
    await store.load()
  } catch (err) {
    dialog.showErrorBox('Finisher could not read its settings', String(err))
    app.quit()
    return
  }

  const selfWrites = new SelfWrites()
  const library = new Library(store, selfWrites, () => {
    const snapshot = library.snapshot()
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC.libraryChanged, snapshot)
    }
  })
  const watcher = new LibraryWatcher(
    library,
    selfWrites,
    () => store.get().roots,
    () => store.get().bounceFolderNames
  )

  registerIpc(store, library, () => {
    // Roots or skip rules may have changed.
    void library.scan().then(() => watcher.restart())
  })
  createWindow()

  await library.scan()
  watcher.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  app.on('before-quit', () => watcher.stop())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
