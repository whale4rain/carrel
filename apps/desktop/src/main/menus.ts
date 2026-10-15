import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { MenuEntry } from '../shared/menu.js'

/**
 * Shows a native right-click menu at the pointer and resolves with the id of
 * the command picked, or undefined when it is closed without one.
 * Shortcuts are only shown: the app's own key handlers run them.
 */
export function popupMenu(window: BrowserWindow, entries: readonly MenuEntry[], webContents = window.webContents): Promise<string | undefined> {
  return new Promise((resolve) => {
    const template = entries.map((entry): MenuItemConstructorOptions => {
      if ('separator' in entry) return { type: 'separator' }
      if ('role' in entry) return { role: entry.role }
      return {
        id: entry.id,
        label: entry.label,
        enabled: entry.enabled ?? true,
        ...(entry.accelerator ? { accelerator: entry.accelerator, registerAccelerator: false } : {}),
        click: () => resolve(entry.id),
      }
    })
    // The menu closes before its click runs on some systems; let the click win.
    Menu.buildFromTemplate(template).popup({ window, frame: webContents.mainFrame, callback: () => setTimeout(() => resolve(undefined), 50) })
  })
}
