import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it } from 'vitest'
import { useThemeStore } from './theme'

afterEach(() => {
  localStorage.clear()
  document.documentElement.dataset.theme = 'dark'
})

describe('主题 store(V5.2 双主题,夜仪默认)', () => {
  it('默认夜仪并应用到 DOM', () => {
    setActivePinia(createPinia())
    const theme = useThemeStore()

    expect(theme.theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('切换昼版并持久化;新 pinia(模拟重启)恢复偏好', () => {
    setActivePinia(createPinia())
    useThemeStore().toggle()
    expect(localStorage.getItem('genshintool.theme')).toBe('light')

    setActivePinia(createPinia())
    expect(useThemeStore().theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('非法存储值回退夜仪', () => {
    localStorage.setItem('genshintool.theme', 'sepia')
    setActivePinia(createPinia())
    expect(useThemeStore().theme).toBe('dark')
  })
})
