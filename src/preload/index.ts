import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type FinisherApi } from '../shared/ipc'

const api: FinisherApi = {
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),
  pickFolder: (options) => ipcRenderer.invoke(IPC.pickFolder, options),
  getPathStatus: (paths) => ipcRenderer.invoke(IPC.getPathStatus, paths)
}

contextBridge.exposeInMainWorld('finisher', api)
