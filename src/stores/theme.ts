import { defineStore } from 'pinia'
import { ref } from 'vue'
import { loadTheme, saveTheme, type ThemeName } from '@/stores/settings'

export type { ThemeName }

/**
 * 主题状态(V5.2 双主题:夜仪为默认,index.html 的 data-theme="dark" 只承担首帧;
 * 昼版偏好经此 store 切换并持久化,T11 简化为 toggle,T18 收编进设置)。
 */
export const useThemeStore = defineStore('theme', () => {
  const theme = ref<ThemeName>(loadTheme())

  function apply(): void {
    document.documentElement.dataset.theme = theme.value
  }

  function set(next: ThemeName): void {
    theme.value = next
    saveTheme(next)
    apply()
  }

  function toggle(): void {
    set(theme.value === 'dark' ? 'light' : 'dark')
  }

  // 让 DOM 属性以 store 为准(恢复昼版偏好时覆盖 index.html 的夜仪兜底)
  apply()

  return { theme, set, toggle }
})
