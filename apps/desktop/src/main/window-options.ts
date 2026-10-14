import { tokens, type Theme } from '@carrel/margin'
import type { BrowserWindowConstructorOptions, TitleBarOverlayOptions } from 'electron'

/** Height of the Windows title strip, where the native caption buttons sit. */
export const WINDOWS_TITLE_HEIGHT = 36

/** The native caption buttons on Windows, colored to sit on the title strip. */
export function titleBarOverlay(theme: Theme): TitleBarOverlayOptions {
  return {
    color: tokens.colors['paper-2'][theme],
    symbolColor: tokens.colors.ink[theme],
    height: WINDOWS_TITLE_HEIGHT,
  }
}

/**
 * Window options per platform. Mac keeps its traffic lights, inset over the
 * sidebar; Windows draws its own title strip with the native caption buttons
 * on top; other platforms keep the system frame.
 */
export function windowOptions(platform: NodeJS.Platform, preload: string, theme: Theme): BrowserWindowConstructorOptions {
  const frame: BrowserWindowConstructorOptions =
    platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 19 } }
      : platform === 'win32'
        ? { titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlay(theme) }
        : {}
  return {
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 560,
    title: 'Carrel',
    show: false,
    backgroundColor: tokens.colors.mat[theme],
    ...frame,
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  }
}
