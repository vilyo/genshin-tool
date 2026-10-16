import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAppDeps, useAppStore } from '@/stores/app'
import { makeFakeStorage, storedRecord } from '@/test-support/appFakes'
import App from './App.vue'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => []),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(async () => null),
}))

beforeEach(() => {
  localStorage.clear()
  document.documentElement.dataset.theme = 'dark'
})

afterEach(() => {
  setAppDeps(null)
})

/** 挂载应用壳并注入假端口(空档案/无游戏目录/取消选文件) */
function mountApp(storage = makeFakeStorage()) {
  const pinia = createPinia()
  setActivePinia(pinia)
  setAppDeps({
    storage: storage.storage,
    listGameDirs: vi.fn(async () => []),
    webcacheCandidates: vi.fn(async () => []),
    pickFile: vi.fn(async () => null),
  })
  return { wrapper: mount(App, { global: { plugins: [pinia] } }), storage }
}

describe('应用壳(核心回归)', () => {
  it('标题栏装配:品牌/一键获取/手动导入/主题/设置占位(禁用)', async () => {
    const { wrapper } = mountApp()
    await flushPromises()

    expect(wrapper.find('.brand-name').text()).toBe('原神工具箱')
    expect(wrapper.text()).toContain('一键获取')
    expect(wrapper.text()).toContain('手动导入')
    const settings = wrapper.findAll('button').find((button) => button.text() === '设置')!
    expect(settings.attributes('disabled')).toBeDefined()
  })

  it('空状态:引导一键获取/粘贴,呼出粘贴弹窗后可取消', async () => {
    const { wrapper } = mountApp()
    await flushPromises()

    expect(wrapper.find('.empty-title').text()).toBe('尚无祈愿档案')
    expect(wrapper.text()).toContain('祈愿-历史记录')

    const pasteButton = wrapper.findAll('button').find((button) => button.text() === '粘贴链接')!
    await pasteButton.trigger('click')
    expect(wrapper.find('.paste-dialog').attributes('role')).toBe('dialog')

    await wrapper.findAll('button').find((button) => button.text() === '取消')!.trigger('click')
    expect(wrapper.find('.paste-dialog').exists()).toBe(false)

    // 忙碌期间空态入口与标题栏一致被闸(#6)
    useAppStore().syncing = true
    await nextTick()
    expect(pasteButton.attributes('disabled')).toBeDefined()
  })

  it('有档案:恢复档案并展示概览挂载点(UID 与记录数)', async () => {
    const { wrapper } = mountApp(makeFakeStorage({ '777': [storedRecord(), storedRecord()] }))
    await flushPromises()

    const store = useAppStore()
    expect(store.currentUid).toBe('777')
    expect(wrapper.find('.overview-line').text()).toContain('UID 777')
    expect(wrapper.find('.overview-line').text()).toContain('共 2 条祈愿记录')
  })

  it('启动自动同步静默(D16):无目录时零弹窗、零打扰', async () => {
    const { wrapper } = mountApp()
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(useAppStore().fetchOpen).toBe(false)
    expect(wrapper.find('.dialog').exists()).toBe(false)
    // jsdom 无探测运行时:不应发出任何探测命令
    expect(invoke).not.toHaveBeenCalled()
  })

  it('主题切换:夜仪 ⇄ 昼版,双主题 CSS 变量可切换', async () => {
    const { wrapper } = mountApp()
    await flushPromises()

    expect(document.documentElement.dataset.theme).toBe('dark')
    await wrapper.find('button[aria-label="切换主题"]').trigger('click')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('genshintool.theme')).toBe('light')
  })
})

describe('Tauri 配置', () => {
  it('package.json 与 tauri.conf.json 版本号一致(状态栏/窗口的单一事实来源)', async () => {
    const pkg = (await import('../package.json')).default
    const conf = (await import('../src-tauri/tauri.conf.json')).default

    expect(conf.version).toBe(pkg.version)
    expect(__APP_VERSION__).toBe(pkg.version)
  })
})
