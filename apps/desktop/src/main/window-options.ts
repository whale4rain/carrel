import type { BrowserWindowConstructorOptions } from 'electron'

/**
 * Window options per platform. The Mac and Windows frames themselves come in
 * milestone 1 (task 3); for now this only keeps the native chrome sensible.
 */
export function windowOptions(platform: NodeJS.Platform, preload: string): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 560,
    title: 'Carrel',
    show: false,
    ...(platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  }
}
