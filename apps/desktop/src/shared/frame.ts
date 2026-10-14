/**
 * Which window frame the renderer draws. Mac insets the traffic lights over
 * the sidebar; Windows has a title strip under the native caption buttons;
 * anything else keeps the system frame.
 */
export type Frame = 'mac' | 'windows' | 'plain'

export const frames = ['mac', 'windows', 'plain'] as const satisfies readonly Frame[]

export function frameFor(platform: string, override?: string): Frame {
  if (override && (frames as readonly string[]).includes(override)) return override as Frame
  if (platform === 'darwin') return 'mac'
  if (platform === 'win32') return 'windows'
  return 'plain'
}

/** How a shortcut reads on this frame: ⌘J on Mac, Ctrl+J elsewhere. */
export function shortcut(frame: Frame, key: string): string {
  return frame === 'mac' ? `⌘${key}` : `Ctrl+${key}`
}
