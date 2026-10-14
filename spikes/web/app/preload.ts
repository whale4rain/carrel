import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('bridge', {
  layout: (layout: unknown) => ipcRenderer.send('desk:layout', layout),
  onLive: (listener: (event: unknown) => void) => ipcRenderer.on('desk:live', (_event, payload: unknown) => listener(payload)),
  onSnapshot: (listener: (event: unknown) => void) =>
    ipcRenderer.on('desk:snapshot', (_event, payload: unknown) => listener(payload)),
})
