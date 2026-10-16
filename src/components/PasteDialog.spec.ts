import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setAppDeps, useAppStore } from '@/stores/app'
import PasteDialog from './PasteDialog.vue'

function mountDialog(open: boolean, setup?: (store: ReturnType<typeof useAppStore>) => void) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useAppStore()
  setup?.(store)
  return { wrapper: mount(PasteDialog, { props: { open }, global: { plugins: [pinia] } }), store }
}

afterEach(() => {
  setAppDeps(null)
})

describe('PasteDialog(粘贴导入入口)', () => {
  it('open=false 不渲染;open=true 呈现对话框与输入框', () => {
    expect(mountDialog(false).wrapper.find('.paste-dialog').exists()).toBe(false)

    const { wrapper } = mountDialog(true)
    expect(wrapper.find('.paste-dialog').attributes('role')).toBe('dialog')
    expect(wrapper.find('textarea').exists()).toBe(true)
    expect(wrapper.text()).toContain('粘贴链接导入')
  })

  it('空文本时导入按钮禁用', () => {
    const { wrapper } = mountDialog(true)
    const submit = wrapper.findAll('button').find((button) => button.text() === '导入')!
    expect(submit.attributes('disabled')).toBeDefined()
  })

  it('行内错误(管线前规范化失败)上屏,弹窗不关闭', async () => {
    const { wrapper, store } = mountDialog(true)
    await wrapper.find('textarea').setValue('不是链接的文字')
    vi.spyOn(store, 'pasteImport').mockImplementation(async () => {
      store.pasteError = '未能从输入中识别有效的祈愿链接,请检查链接完整性'
      return false
    })

    await wrapper.findAll('button').find((button) => button.text() === '导入')!.trigger('click')

    expect(wrapper.find('.error-text').text()).toContain('未能从输入中识别')
    expect(wrapper.emitted('close')).toBeUndefined() // 失败保留输入与错误,便于修改重试
  })

  it('打开即清上次残留的行内错误(#7)', async () => {
    const { wrapper, store } = mountDialog(false, (store) => {
      store.pasteError = '上次会话残留的错误'
    })
    expect(store.pasteError).toBe('上次会话残留的错误')

    await wrapper.setProps({ open: true })

    expect(store.pasteError).toBeNull()
    expect(wrapper.find('.error-text').exists()).toBe(false)
  })

  it('提交成功:走 store 管线并让位关闭、清空输入', async () => {
    const { wrapper, store } = mountDialog(true)
    const spy = vi.spyOn(store, 'pasteImport').mockResolvedValue(true)
    await wrapper.find('textarea').setValue('https://example.com/?auth_appid=webview_gacha&authkey=Ab%2Bcd')

    await wrapper.findAll('button').find((button) => button.text() === '导入')!.trigger('click')

    expect(spy).toHaveBeenCalledWith(
      'https://example.com/?auth_appid=webview_gacha&authkey=Ab%2Bcd',
    )
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('')
  })

  it('ESC 关闭', async () => {
    const { wrapper } = mountDialog(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
