import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { accelerator, SHORTCUTS } from '../shared/shortcuts.js'

/**
 * The menu bar (on a Mac, at the top of the screen). Carrel's own commands show
 * their shortcuts but don't take the keys: the desk handles those itself, so a
 * key does the same thing whether a note, the agent or the desk has it. Picking
 * one sends it to the window as `menu:command`.
 */
export function setAppMenu(platform: string): void {
  const command = (id: string, label = labelOf(id)): MenuItemConstructorOptions => {
    const keys = accelerator(id, platform)
    return {
      label,
      ...(keys ? { accelerator: keys, registerAccelerator: false } : {}),
      click: (_item, window) => {
        const focused = window instanceof BrowserWindow ? window : BrowserWindow.getFocusedWindow()
        // The Keep window has no desk to run commands; they go to Carrel's main window.
        const target = focused && !isKeep(focused) ? focused : BrowserWindow.getAllWindows().find((other) => !isKeep(other))
        target?.webContents.send('menu:command', id)
      },
    }
  }
  const template: MenuItemConstructorOptions[] = [
    ...(platform === 'darwin' ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        command('search'),
        command('agent', 'Agent'),
        command('sidebar', 'Sidebar'),
        { type: 'separator' },
        command('zoom-in', 'Zoom In'),
        command('zoom-out', 'Zoom Out'),
        command('actual-size', 'Actual Size'),
        command('fit', 'Fit Everything'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Notes',
      submenu: [command('open-note', 'Open Note…'), command('daily', 'Today’s Note')],
    },
    {
      label: 'Memory',
      submenu: [command('keep', 'Keep…'), { type: 'separator' }, command('import-chatgpt', 'Import ChatGPT Export…'), command('memory-settings', 'Reading Trail and Memory…')],
    },
    {
      label: 'Desk',
      submenu: [command('focus', 'Focus'), command('leave', 'Back to Desk'), { type: 'separator' }, command('that', 'that.'), command('hand', 'Hand Tool'), command('select-all', 'Select All Sheets')],
    },
    { role: 'windowMenu' },
    { role: 'help', submenu: [command('shortcuts', 'Keyboard Shortcuts')] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function labelOf(id: string): string {
  for (const group of SHORTCUTS) for (const shortcut of group.shortcuts) if (shortcut.id === id) return shortcut.label
  return id
}

function isKeep(window: BrowserWindow): boolean {
  return new URL(window.webContents.getURL() || 'about:blank').searchParams.has('keep')
}
