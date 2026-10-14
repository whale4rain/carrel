import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('bridge', {
  capture: (rect: unknown) => ipcRenderer.invoke('video:capture', rect),
})
