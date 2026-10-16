import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UnsupportedPlatformError } from '@/domain/errors'
import type { GameDirInfo } from '@/services/tauriPorts'
import { setAppDeps, useAppStore } from '@/stores/app'
import { makeFakeStorage, storedRecord } from '@/test-support/appFakes'
import { useThemeStore } from '@/stores/theme'
import SettingsPanel from './SettingsPanel.vue'

function mountPanel(storage = makeFakeStorage(), deps: Record<string, unknown> = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  setAppDeps({
    storage: storage.storage,
    listGameDirs: vi.fn(async () => []),
    pickFile: vi.fn(async () => null),
    ...deps,
  })
  const wrapper = mount(SettingsPanel)
  return { wrapper, storage }
}

afterEach(() => {
  setAppDeps(null)
  localStorage.clear()
  document.documentElement.dataset.theme = 'dark'
})

describe('设置面板(T18,F5)', () => {
  it('六组条目齐备:主题/启动同步/游戏目录/档案管理/备份/清空 + 关于', async () => {
    const { wrapper } = mountPanel()
    useAppStore().settingsOpen = true
    await flushPromises()

    expect(wrapper.find('.settings-drawer').exists()).toBe(true)
    expect(wrapper.text()).toContain('主题')
    expect(wrapper.text()).toContain('启动时自动同步')
    expect(wrapper.text()).toContain('仅缓存链接有效时静默增量')
    expect(wrapper.text()).toContain('游戏客户端目录')
    expect(wrapper.text()).toContain('自动探测优先,手动指定暂不参与获取')
    expect(wrapper.text()).toContain('档案管理')
    expect(wrapper.text()).toContain('备份与恢复')
    expect(wrapper.text()).toContain('导出备份')
    expect(wrapper.text()).toContain('导入备份')
    expect(wrapper.text()).toContain('清空数据')
    expect(wrapper.find('.about').exists()).toBe(true)
  })

  it('默认收起;store.openSettings 后渲染,关闭按钮收起', async () => {
    const { wrapper } = mountPanel()
    const store = useAppStore()
    expect(wrapper.find('.settings-drawer').exists()).toBe(false)

    store.openSettings()
    await flushPromises()
    expect(wrapper.find('.settings-drawer').exists()).toBe(true)

    await wrapper.find('.settings-close').trigger('click')
    expect(store.settingsOpen).toBe(false)
    expect(wrapper.find('.settings-drawer').exists()).toBe(false)
  })

  it('主题分段:点昼版写偏好并应用到 DOM', async () => {
    const { wrapper } = mountPanel()
    useAppStore().settingsOpen = true
    await flushPromises()

    const light = wrapper.findAll('.seg button').find((b) => b.text() === '昼版')!
    await light.trigger('click')

    expect(useThemeStore().theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('genshintool.theme')).toBe('light')
  })

  it('启动同步开关:切换即持久化(localStorage)', async () => {
    const { wrapper } = mountPanel()
    const store = useAppStore()
    store.settingsOpen = true
    await flushPromises()

    const toggle = wrapper.find('.toggle[aria-label="启动时自动同步"]')
    expect(toggle.attributes('aria-pressed')).toBe('true') // 默认开

    await toggle.trigger('click')
    expect(toggle.attributes('aria-pressed')).toBe('false')
    expect(localStorage.getItem('genshintool.autoSync')).toBe('false')
  })

  it('目录探测:非 Windows 显示「自动获取仅支持 Windows」', async () => {
    const { wrapper } = mountPanel(makeFakeStorage(), {
      listGameDirs: vi.fn(async () => {
        throw new UnsupportedPlatformError()
      }),
    })
    const store = useAppStore()

    store.openSettings()
    await flushPromises()

    expect(wrapper.text()).toContain('自动获取仅支持 Windows')
  })

  it('目录探测:国服/国际服列表展示', async () => {
    const dirs: GameDirInfo[] = [
      { region: 'cn', gameDir: 'D:/Games/YuanShen_Data', logMtime: '2026-10-16T08:00:00Z' },
      { region: 'global', gameDir: 'D:/Games/GenshinImpact_Data', logMtime: '2026-10-15T08:00:00Z' },
    ]
    const { wrapper } = mountPanel(makeFakeStorage(), { listGameDirs: vi.fn(async () => dirs) })
    useAppStore().openSettings()
    await flushPromises()

    const regions = wrapper.findAll('.dir-region').map((node) => node.text())
    expect(regions).toEqual(['国服', '国际服'])
    expect(wrapper.text()).toContain('D:/Games/YuanShen_Data')
  })

  it('手动指定目录:写入 localStorage 并展示;取消静默', async () => {
    const pickDirectory = vi.fn()
      .mockResolvedValueOnce('/Applications/Genshin Impact.app/Contents/Game')
      .mockResolvedValueOnce(null)
    const { wrapper } = mountPanel(makeFakeStorage(), { pickDirectory })
    const store = useAppStore()
    store.settingsOpen = true
    await flushPromises()

    await wrapper.findAll('.set-btn').find((b) => b.text() === '指定目录')!.trigger('click')
    expect(localStorage.getItem('genshintool.gameDir')).toBe('/Applications/Genshin Impact.app/Contents/Game')
    expect(wrapper.text()).toContain('/Applications/Genshin Impact.app/Contents/Game')

    await wrapper.findAll('.set-btn').find((b) => b.text() === '指定目录')!.trigger('click')
    expect(pickDirectory).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem('genshintool.gameDir')).toBe('/Applications/Genshin Impact.app/Contents/Game')
  })

  it('备份按钮接 store 编排:导出在无档案时禁用,导入走 pick 流', async () => {
    const pickFile = vi.fn(async () => null)
    const { wrapper } = mountPanel(makeFakeStorage(), { pickFile })
    const store = useAppStore()
    store.settingsOpen = true
    await flushPromises()

    const exportBtn = wrapper.findAll('button').find((b) => b.text() === '导出备份')!
    expect(exportBtn.attributes('disabled')).toBeDefined() // 无档案

    const importBtn = wrapper.findAll('button').find((b) => b.text() === '导入备份')!
    await importBtn.trigger('click')
    expect(pickFile).toHaveBeenCalledTimes(1)
  })

  it('档案管理:列表展示元数据,当前档案高亮并显示记录数,非当前不显示', async () => {
    const storage = makeFakeStorage({ '777': [storedRecord()] })
    storage.db.set('888', [])
    const { wrapper } = mountPanel(storage)
    const store = useAppStore()
    store.settingsOpen = true
    await store.init()
    await store.switchArchive('888')
    await flushPromises()

    expect(store.currentUid).toBe('888')
    const rows = wrapper.findAll('.archive-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('UID 777')
    expect(rows[0]!.text()).not.toContain('记录')
    expect(rows[0]!.classes()).not.toContain('current')
    expect(rows[1]!.classes()).toContain('current')
    expect(rows[1]!.text()).toContain('记录 0 条')
    // 切换按钮切回 777
    await rows[0]!.find('.set-btn').trigger('click')
    expect(store.currentUid).toBe('777')
  })

  it('未关联 UID 档案(\'0\' 哨兵)有专门标注', async () => {
    const storage = makeFakeStorage()
    storage.db.set('0', [])
    const { wrapper } = mountPanel(storage)
    const store = useAppStore()
    store.settingsOpen = true
    await store.init()
    await flushPromises()

    expect(wrapper.text()).toContain('未关联 UID')
  })
})
