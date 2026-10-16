import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CacheLinkNotFoundError, ApiError, LinkExpiredError, UnsupportedPlatformError } from '@/domain/errors'
import type { SyncAllProgress, SyncAllResult } from '@/domain/syncAll'
import { setAppDeps, useAppStore } from '@/stores/app'
import FetchDialog from './FetchDialog.vue'

/** 先落 store 状态再挂载(条件渲染以首帧呈现) */
function mountDialog(setup?: (store: ReturnType<typeof useAppStore>) => void) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useAppStore()
  setup?.(store)
  return { wrapper: mount(FetchDialog, { global: { plugins: [pinia] } }), store }
}

afterEach(() => {
  setAppDeps(null)
})

const RESULT: SyncAllResult = {
  pools: [
    { poolCode: 301, fetched: 3, added: 3 },
    { poolCode: 302, fetched: 2, added: 2 },
  ],
  fetched: 5,
  added: 5,
  uid: '777',
}

const PROGRESS: SyncAllProgress = {
  poolIndex: 0,
  poolCode: 301,
  page: 2,
  fetchedThisPool: 40,
  addedThisPool: 3,
}

describe('FetchDialog(三入口共用进行中弹窗)', () => {
  it('空闲时不渲染', () => {
    expect(mountDialog().wrapper.find('.dialog').exists()).toBe(false)
  })

  it('S7 过期文案:定稿原句 + 重试引导(不展示错误码)', () => {
    const { wrapper } = mountDialog((store) => {
      store.fetchOpen = true
      store.fetchError = new LinkExpiredError()
    })

    expect(wrapper.find('.error-text').text()).toBe('祈愿链接已过期,请在游戏内重新打开祈愿记录页')
    expect(wrapper.find('.retain-note').text()).toContain('中断前已拉取的记录已保留')
    expect(wrapper.text()).not.toContain('-101')
    expect(wrapper.findAll('button').some((button) => button.text() === '重试')).toBe(true)
  })

  it('ApiError 不展示重试按钮(§7 不重试,#4)', () => {
    const { wrapper } = mountDialog((store) => {
      store.fetchOpen = true
      store.fetchError = new ApiError(-5, '系统繁忙')
    })

    expect(wrapper.find('.error-text').text()).toBe('官方接口返回错误:系统繁忙')
    expect(wrapper.findAll('button').some((button) => button.text() === '重试')).toBe(false)
  })

  it('macOS 平台文案:引导手动粘贴,无重试按钮', () => {
    const { wrapper } = mountDialog((store) => {
      store.fetchOpen = true
      store.fetchError = new UnsupportedPlatformError()
    })

    expect(wrapper.text()).toContain('手动粘贴')
    expect(wrapper.findAll('button').some((button) => button.text() === '重试')).toBe(false)
  })

  it('错误态点重试:无最近动作时关闭弹窗', async () => {
    const { wrapper, store } = mountDialog((store) => {
      store.fetchOpen = true
      store.fetchError = new LinkExpiredError()
    })

    await wrapper.findAll('button').find((button) => button.text() === '重试')!.trigger('click')

    expect(store.fetchOpen).toBe(false)
  })

  it('完成报告:总数 + 分池明细,完成后关闭', async () => {
    const { wrapper, store } = mountDialog((store) => {
      store.fetchOpen = true
      store.fetchResult = RESULT
    })

    expect(wrapper.find('.done-line').text()).toContain('拉取 5 条')
    expect(wrapper.find('.done-line').text()).toContain('新增 5 条')
    expect(wrapper.text()).toContain('角色活动祈愿')
    expect(wrapper.text()).toContain('武器活动祈愿')

    await wrapper.findAll('button').find((button) => button.text() === '完成')!.trigger('click')
    expect(store.fetchOpen).toBe(false)
  })

  it('进行中:分池进度行 + 限速说明文案', () => {
    const { wrapper } = mountDialog((store) => {
      store.fetchOpen = true
      store.syncing = true
      store.syncProgress = PROGRESS
    })

    expect(wrapper.find('.progress-line').text()).toContain('角色活动祈愿')
    expect(wrapper.find('.progress-line').text()).toContain('第 1 / 5 池')
    expect(wrapper.find('.progress-line').text()).toContain('第 2 页')
    expect(wrapper.find('.rate-note').text()).toContain('0.5 秒')
    expect(wrapper.find('.rate-note').text()).toContain('自动重试')
  })

  it('探测段文案(定位/读缓存/验证链接)上屏', () => {
    const { wrapper } = mountDialog((store) => {
      store.fetchOpen = true
      store.fetchStage = '正在读取游戏缓存…'
    })

    expect(wrapper.find('.stage-line').text()).toBe('正在读取游戏缓存…')
  })

  it('多目录选择视图:选目录后继续管线(注入空缓存 → 引导文案)', async () => {
    setAppDeps({ webcacheCandidates: vi.fn(async () => []) })
    const { wrapper, store } = mountDialog((store) => {
      store.fetchOpen = true
      store.pendingDirs = [
        { region: 'cn', gameDir: 'D:/CN', logMtime: 'a' },
        { region: 'global', gameDir: 'D:/Global', logMtime: 'b' },
      ]
    })

    const rows = wrapper.findAll('.pick-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('国服')
    expect(rows[1]!.text()).toContain('国际服')

    await rows[0]!.trigger('click')

    expect(store.pendingDirs).toBeNull()
    expect(store.fetchError).toBeInstanceOf(CacheLinkNotFoundError)
  })

  it('多 UID/切换确认/哨兵并入挂起时本弹窗让位', async () => {
    const { wrapper, store } = mountDialog((store) => {
      store.fetchOpen = true
      store.pendingCandidates = []
    })
    expect(wrapper.find('.dialog').exists()).toBe(false)

    store.pendingCandidates = null
    store.pendingMismatch = { resolvedUid: '777', url: 'https://x' }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.dialog').exists()).toBe(false)

    store.pendingMismatch = null
    store.pendingSentinelMerge = { count: 1 }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.dialog').exists()).toBe(false)
  })
})
