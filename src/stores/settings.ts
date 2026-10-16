/**
 * 偏好存储(T11 简化版:localStorage 即可,T18 再统一):
 * 全部 key 与读写集中在此,读写一律容错(存储不可用时跳过,不影响主流程)。
 */
export const STORAGE_KEYS = {
  theme: 'genshintool.theme',
  autoSync: 'genshintool.autoSync',
  gameDir: 'genshintool.gameDir',
} as const

export type ThemeName = 'dark' | 'light'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 存储不可用时跳过记忆,不影响本次操作
  }
}

/** 主题:夜仪(dark)为默认(V5.2 定稿);非法值按默认处理 */
export function loadTheme(): ThemeName {
  return read(STORAGE_KEYS.theme) === 'light' ? 'light' : 'dark'
}

export function saveTheme(theme: ThemeName): void {
  write(STORAGE_KEYS.theme, theme)
}

/** 启动自动同步开关(PRD F5):默认开;仅显式存过 'false' 才视为关 */
export function loadAutoSync(): boolean {
  return read(STORAGE_KEYS.autoSync) !== 'false'
}

export function saveAutoSync(enabled: boolean): void {
  write(STORAGE_KEYS.autoSync, enabled ? 'true' : 'false')
}

/**
 * 手动指定的游戏客户端目录(PRD F5):v1 自动探测优先,手动指定仅作面板展示与
 * 后续版本使用,不参与一键获取的探测链路(T18 裁决)。
 */
export function loadGameDir(): string | null {
  return read(STORAGE_KEYS.gameDir)
}

export function saveGameDir(path: string | null): void {
  if (path === null) {
    try {
      localStorage.removeItem(STORAGE_KEYS.gameDir)
    } catch {
      // 存储不可用时跳过清除
    }
    return
  }
  write(STORAGE_KEYS.gameDir, path)
}
