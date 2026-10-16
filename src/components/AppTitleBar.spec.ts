import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setAppDeps, useAppStore } from '@/stores/app'
import { useThemeStore } from '@/stores/theme'
import AppTitleBar from './AppTitleBar.vue'

function mountBar() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(AppTitleBar, { global: { plugins: [pinia] } })
}

afterEach(() => {
  setAppDeps(null)
  localStorage.clear()
  document.documentElement.dataset.theme = 'dark'
})

describe('标题栏装配', () => {
  it('品牌与入口齐备:一键获取/手动导入/主题/设置占位(禁用)', () => {
    const wrapper = mountBar()

    expect(wrapper.find('.brand-name').text()).toBe('原神工具箱')
    expect(wrapper.text()).toContain('一键获取')
    expect(wrapper.text()).toContain('手动导入')
    const settings = wrapper.findAll('button').find((button) => button.text() === '设置')!
    expect(settings.attributes('disabled')).toBeDefined()
    expect(wrapper.find('button[aria-label="切换主题"]').exists()).toBe(true)
  })

  it('UID 芯片随当前档案显隐', async () => {
    const wrapper = mountBar()
    expect(wrapper.find('.uid-chip').exists()).toBe(false)

    useAppStore().currentUid = '777'
    await nextTick()

    expect(wrapper.find('.uid-chip').text()).toBe('UID 777')
  })

  it('手动导入下拉:粘贴/文件/Excel 三入口;粘贴与 Excel 上抛事件', async () => {
    const wrapper = mountBar()

    await wrapper.findAll('button').find((button) => button.text().includes('手动导入'))!.trigger('click')

    const items = wrapper.findAll('.menu-item')
    expect(items.map((item) => item.text())).toEqual(['粘贴链接', '导入文件', 'Excel 历史迁入'])

    await items[0]!.trigger('click')
    expect(wrapper.emitted('open-paste')).toHaveLength(1)

    await wrapper.findAll('button').find((button) => button.text().includes('手动导入'))!.trigger('click')
    await wrapper.findAll('.menu-item').find((item) => item.text().includes('Excel'))!.trigger('click')
    expect(wrapper.emitted('open-excel')).toHaveLength(1)
  })

  it('下拉「导入文件」走 store 文件导入(取消选文件则静默)', async () => {
    const pickFile = vi.fn(async () => null)
    setAppDeps({ pickFile })
    const wrapper = mountBar()

    await wrapper.findAll('button').find((button) => button.text().includes('手动导入'))!.trigger('click')
    await wrapper.findAll('.menu-item').find((item) => item.text() === '导入文件')!.trigger('click')

    expect(pickFile).toHaveBeenCalledTimes(1)
  })

  it('一键获取按钮进 store 编排(无目录时错误态可见于 FetchDialog)', async () => {
    setAppDeps({ listGameDirs: vi.fn(async () => []) })
    const wrapper = mountBar()
    const store = useAppStore()

    await wrapper.findAll('button').find((button) => button.text().includes('一键获取'))!.trigger('click')

    expect(store.fetchOpen).toBe(true)
    expect(store.fetchError).not.toBeNull()
  })

  it('主题按钮在夜仪/昼版间切换并持久化', async () => {
    const wrapper = mountBar()

    await wrapper.find('button[aria-label="切换主题"]').trigger('click')

    expect(useThemeStore().theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('genshintool.theme')).toBe('light')
  })
})
