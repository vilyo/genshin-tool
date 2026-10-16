import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import type { ProbeCandidate } from '@/domain/probe'
import { useAppStore } from '@/stores/app'
import UidSelectDialog from './UidSelectDialog.vue'

/** 先落 store 状态再挂载(条件渲染以首帧呈现) */
function mountDialog(setup?: (store: ReturnType<typeof useAppStore>) => void) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useAppStore()
  setup?.(store)
  return { wrapper: mount(UidSelectDialog, { global: { plugins: [pinia] } }), store }
}

const CANDIDATES: ProbeCandidate[] = [
  {
    url: 'https://a',
    uid: '777',
    latestId: '1900000000000000000',
    latestTime: '2026-01-01 12:00:00',
  },
  { url: 'https://b', uid: null, latestId: null, latestTime: null },
]

describe('UidSelectDialog(D9 多候选)', () => {
  it('无待选候选时不渲染', () => {
    expect(mountDialog().wrapper.find('.dialog').exists()).toBe(false)
  })

  it('候选列表:uid 与探底最新记录时间;匿名候选注明「UID 拉取后确认」', () => {
    const { wrapper } = mountDialog((store) => {
      store.pendingCandidates = CANDIDATES
    })

    const rows = wrapper.findAll('.pick-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('UID 777')
    expect(rows[0]!.text()).toContain('最新记录 2026-01-01 12:00:00')
    expect(rows[1]!.text()).toContain('UID 拉取后确认')
    expect(rows[1]!.text()).toContain('暂无角色池记录') // 探底只查 301,不越权断言全账号(#5)
  })

  it('选定候选:交给 store 编排(chooseCandidate)', async () => {
    const { wrapper, store } = mountDialog((store) => {
      store.pendingCandidates = CANDIDATES
    })
    const spy = vi.spyOn(store, 'chooseCandidate').mockResolvedValue(undefined)

    await wrapper.findAll('.pick-row')[1]!.trigger('click')

    expect(spy).toHaveBeenCalledWith(CANDIDATES[1])
  })

  it('取消:清空候选并关闭弹窗', async () => {
    const { wrapper, store } = mountDialog((store) => {
      store.fetchOpen = true
      store.pendingCandidates = CANDIDATES
    })

    await wrapper.findAll('button').find((button) => button.text() === '取消')!.trigger('click')

    expect(store.pendingCandidates).toBeNull()
    expect(store.fetchOpen).toBe(false)
  })
})
