import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/stores/app'
import SentinelMergeConfirm from './SentinelMergeConfirm.vue'

/** 先落 store 状态再挂载(条件渲染以首帧呈现) */
function mountDialog(setup?: (store: ReturnType<typeof useAppStore>) => void) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useAppStore()
  setup?.(store)
  return { wrapper: mount(SentinelMergeConfirm, { global: { plugins: [pinia] } }), store }
}

describe("SentinelMergeConfirm('0' 哨兵并入确认)", () => {
  it('无待确认时不渲染', () => {
    expect(mountDialog().wrapper.find('.dialog').exists()).toBe(false)
  })

  it('文案写明目标档案与并入条数,确认按钮携带总量', () => {
    const { wrapper } = mountDialog((store) => {
      store.currentUid = '777'
      store.pendingSentinelMerge = { count: 3 }
    })

    expect(wrapper.find('.dialog-hint').text()).toContain('3 条未关联 UID 的记录')
    expect(wrapper.findAll('button').some((button) => button.text() === '并入 3 条')).toBe(true)
  })

  it('确认并入:交 store 迁移', async () => {
    const { wrapper, store } = mountDialog((store) => {
      store.pendingSentinelMerge = { count: 3 }
    })
    const spy = vi.spyOn(store, 'confirmSentinelMerge').mockResolvedValue(undefined)

    await wrapper.findAll('button').find((button) => button.text() === '并入 3 条')!.trigger('click')

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it("暂不并入:'0' 档案保留,对话框关闭", async () => {
    const { wrapper, store } = mountDialog((store) => {
      store.pendingSentinelMerge = { count: 3 }
    })

    await wrapper.findAll('button').find((button) => button.text() === '暂不并入')!.trigger('click')

    expect(store.pendingSentinelMerge).toBeNull()
  })
})
