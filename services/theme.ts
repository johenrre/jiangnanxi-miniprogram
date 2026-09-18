export const THEME_KEYS = [
  'jiangnanxi',
  'healing-ins',
] as const

export type ThemeKey = typeof THEME_KEYS[number]

export const DEFAULT_THEME_KEY: ThemeKey = 'jiangnanxi'

const LEGACY_THEME_STORAGE_KEY = 'stone_active_theme_v1'
const THEME_KEY_SET = new Set<string>(THEME_KEYS)
const themeListeners = new Set<(themeClass: string, themeKey: ThemeKey) => void>()

// 主题属于公开配置，旧版本持久化的主题可能在启动时造成旧主题闪现。
try {
  wx.removeStorageSync(LEGACY_THEME_STORAGE_KEY)
} catch {
  // 清理失败时继续使用本次运行的默认主题。
}

export function normalizeThemeKey(value: unknown): ThemeKey {
  const normalized = String(value ?? '').trim()
  return THEME_KEY_SET.has(normalized) ? normalized as ThemeKey : DEFAULT_THEME_KEY
}

let activeThemeKey: ThemeKey = DEFAULT_THEME_KEY

export function getActiveThemeKey(): ThemeKey {
  return activeThemeKey
}

export function getThemeClass(themeKey: ThemeKey): string {
  return `theme-${themeKey}`
}

export function getActiveThemeClass(): string {
  return getThemeClass(activeThemeKey)
}

export function setActiveThemeKey(value: unknown): ThemeKey {
  const themeKey = normalizeThemeKey(value)
  if (themeKey === activeThemeKey) return activeThemeKey
  activeThemeKey = themeKey
  const themeClass = getThemeClass(themeKey)
  for (const listener of themeListeners) listener(themeClass, themeKey)
  return themeKey
}

export function subscribeTheme(
  listener: (themeClass: string, themeKey: ThemeKey) => void,
): () => void {
  themeListeners.add(listener)
  listener(getActiveThemeClass(), activeThemeKey)
  return () => themeListeners.delete(listener)
}
