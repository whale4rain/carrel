import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('spike', {
  info: () => ipcRenderer.invoke('spike:info'),
  ask: (text: string) => ipcRenderer.invoke('spike:ask', text),
  onEvent: (listener: (event: unknown) => void) => {
    ipcRenderer.on('spike:event', (_event, payload: unknown) => listener(payload))
  },
})
