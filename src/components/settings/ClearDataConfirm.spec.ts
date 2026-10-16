import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setAppDeps, useAppStore } from '@/stores/app'
import { makeFakeStorage, storedRecord } from '@/test-support/appFakes'
import ClearDataConfirm from './ClearDataConfirm.vue'

function mountConfirm(storage = makeFakeStorage()) {
  const pinia = createPinia()
  setActivePinia(pinia)
  setAppDeps({
    storage: storage.storage,
    listGameDirs: vi.fn(async () => []),
    pickFile: vi.fn(async () => null),
  })
  const wrapper = mount(ClearDataConfirm)
  return { wrapper, storage }
}

afterEach(() => {
  setAppDeps(null)
  localStorage.clear()
})

describe('清空数据二次确认(T18,F4)', () => {
  it('未挂起确认时不渲染', () => {
    const { wrapper } = mountConfirm()
    expect(wrapper.find('[aria-label="清空数据确认"]').exists()).toBe(false)
  })

  it('确认层写明 UID/记录数/不可恢复与档案保留,建议先备份', async () => {
    const { wrapper } = mountConfirm(makeFakeStorage({ '777': [storedRecord(), storedRecord()] }))
    const store = useAppStore()
    await store.init()
    store.askClearArchive()
    await flushPromises()

    const hint = wrapper.find('.dialog-hint').text()
    expect(hint).toContain('777')
    expect(hint).toContain('2 条')
    expect(hint).toContain('不可恢复')
    expect(hint).toContain('导出备份')
    expect(hint).toContain('档案本身保留')
  })

  it('取消:零写入(不调 clearArchive)', async () => {
    const storage = makeFakeStorage({ '777': [storedRecord()] })
    const { wrapper } = mountConfirm(storage)
    const store = useAppStore()
    await store.init()
    store.askClearArchive()
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === '取消')!.trigger('click')
    expect(store.pendingClear).toBe(false)
    expect(storage.calls.clearArchive).not.toHaveBeenCalled()
    expect(store.records).toHaveLength(1)
  })

  it('确认:清当前档案记录与同步水位,档案保留在列表,空档留在原地', async () => {
    const storage = makeFakeStorage({ '777': [storedRecord(), storedRecord()] })
    const { wrapper } = mountConfirm(storage)
    const store = useAppStore()
    await store.init()
    store.askClearArchive()
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === '确认清空')!.trigger('click')
    await flushPromises()

    expect(storage.calls.clearArchive).toHaveBeenCalledWith('777')
    expect(store.records).toEqual([]) // 置为空档,不自动切换
    expect(store.currentUid).toBe('777')
    expect(store.archives.some((archive) => archive.uid === '777')).toBe(true) // 档案行保留
    expect(store.message?.kind).toBe('success')
    expect(store.message?.text).toContain('已清空 UID 777 的 2 条')
    expect(store.pendingClear).toBe(false)
  })

  it('无档案时 askClearArchive 不挂起确认', async () => {
    const { wrapper } = mountConfirm()
    const store = useAppStore()
    await store.init()

    store.askClearArchive()
    await flushPromises()
    expect(store.pendingClear).toBe(false)
    expect(wrapper.find('[aria-label="清空数据确认"]').exists()).toBe(false)
  })
})
