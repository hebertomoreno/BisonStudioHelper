import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type FinisherApi } from '../shared/ipc'
import type { LibrarySnapshot } from '../shared/songs'

const api: FinisherApi = {
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),
  pickFolder: (options) => ipcRenderer.invoke(IPC.pickFolder, options),
  getPathStatus: (paths) => ipcRenderer.invoke(IPC.getPathStatus, paths),

  getLibrary: () => ipcRenderer.invoke(IPC.getLibrary),
  rescan: () => ipcRenderer.invoke(IPC.rescan),
  setLane: (ids, lane, bumpToQueue) => ipcRenderer.invoke(IPC.setLane, ids, lane, bumpToQueue),
  reorder: (lane, ids) => ipcRenderer.invoke(IPC.reorder, lane, ids),
  setQueueSort: (sort) => ipcRenderer.invoke(IPC.setQueueSort, sort),
  setSavedFilters: (filters) => ipcRenderer.invoke(IPC.setSavedFilters, filters),
  addSongToRelease: (songId, releaseId) => ipcRenderer.invoke(IPC.addSongToRelease, songId, releaseId),
  setTitle: (songId, title) => ipcRenderer.invoke(IPC.setTitle, songId, title),
  setStatus: (songId, status) => ipcRenderer.invoke(IPC.setStatus, songId, status),
  setExcitement: (songId, value, note) => ipcRenderer.invoke(IPC.setExcitement, songId, value, note),
  pickReleaseArt: (releaseId) => ipcRenderer.invoke(IPC.pickReleaseArt, releaseId),
  onLibraryChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, snapshot: LibrarySnapshot): void => listener(snapshot)
    ipcRenderer.on(IPC.libraryChanged, handler)
    return () => ipcRenderer.removeListener(IPC.libraryChanged, handler)
  }
}

contextBridge.exposeInMainWorld('finisher', api)
