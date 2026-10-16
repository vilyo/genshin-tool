import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/stores/app'
import ArchiveSwitchConfirm from './ArchiveSwitchConfirm.vue'

/** 先落 store 状态再挂载(条件渲染以首帧呈现) */
function mountDialog(setup?: (store: ReturnType<typeof useAppStore>) => void) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useAppStore()
  setup?.(store)
  return { wrapper: mount(ArchiveSwitchConfirm, { global: { plugins: [pinia] } }), store }
}

describe('ArchiveSwitchConfirm(uid 不一致切换确认)', () => {
  it('无待确认时不渲染', () => {
    expect(mountDialog().wrapper.find('.dialog').exists()).toBe(false)
  })

  it('文案写明链接 uid 与当前档案,零写入承诺', () => {
    const { wrapper } = mountDialog((store) => {
      store.currentUid = '111'
      store.pendingMismatch = { resolvedUid: '777', url: 'https://x' }
    })

    const hint = wrapper.find('.dialog-hint').text()
    expect(hint).toContain('777')
    expect(hint).toContain('111')
    expect(hint).toContain('保留在本机')
  })

  it('确认切换:交 store 以新 uid 重入', async () => {
    const { wrapper, store } = mountDialog((store) => {
      store.pendingMismatch = { resolvedUid: '777', url: 'https://x' }
    })
    const spy = vi.spyOn(store, 'confirmArchiveSwitch').mockResolvedValue(undefined)

    await wrapper.findAll('button').find((button) => button.text() === '切换并导入')!.trigger('click')

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('取消:中止零写入并关闭拉取弹窗', async () => {
    const { wrapper, store } = mountDialog((store) => {
      store.fetchOpen = true
      store.pendingMismatch = { resolvedUid: '777', url: 'https://x' }
    })

    await wrapper.findAll('button').find((button) => button.text() === '取消')!.trigger('click')

    expect(store.pendingMismatch).toBeNull()
    expect(store.fetchOpen).toBe(false)
  })
})
