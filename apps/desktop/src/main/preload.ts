import { contextBridge } from 'electron'

// The typed IPC bridge between renderer and main starts here.
contextBridge.exposeInMainWorld('carrel', {
  platform: process.platform,
})
