import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BACKUP_FORMAT_VERSION, exportBackup } from '@/domain/backup'
import type { WishRecord } from '@/domain/records'
import { setAppDeps, useAppStore } from '@/stores/app'
import { makeFakeStorage, storedRecord, type FakeStorage } from '@/test-support/appFakes'
import BackupImportConfirm from './BackupImportConfirm.vue'

/** 组装备份文本(走真 exportBackup 保证形状;overrides 模拟损坏/过新) */
function backupText(
  uid: string,
  records: WishRecord[],
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({ ...exportBackup(records, uid, '2026-10-16T00:00:00.000Z'), ...overrides })
}

const TWO_FIVES: WishRecord[] = [
  { gachaType: 301, time: '2026-01-05 10:00:00', name: '那维莱特', rankType: 5, id: '1900000000000000001' },
  { gachaType: 200, time: '2026-01-06 10:00:00', name: '天空之翼', rankType: 5, id: '1900000000000000002' },
]

function mountImport(storage: FakeStorage | null = null, deps: Record<string, unknown> = {}) {
  const fake = storage ?? makeFakeStorage()
  const pinia = createPinia()
  setActivePinia(pinia)
  setAppDeps({
    storage: fake.storage,
    listGameDirs: vi.fn(async () => []),
    pickFile: vi.fn(async () => null),
    readTextFile: vi.fn(async () => ''),
    ...deps,
  })
  const wrapper = mount(BackupImportConfirm)
  return { wrapper, storage: fake }
}

afterEach(() => {
  setAppDeps(null)
  localStorage.clear()
})

async function runImport(): Promise<void> {
  await useAppStore().importBackupFile()
  await flushPromises()
}

describe('备份导入预览确认(T18,F4 / spec 01 §6)', () => {
  it('导入到非当前档案:预览展示目标 UID 与新增/回填/跳过,附切换提示', async () => {
    const storage = makeFakeStorage({ '777': [storedRecord()] })
    const { wrapper } = mountImport(storage, {
      pickFile: vi.fn(async () => '/tmp/genshintool-backup-888.json'),
      readTextFile: vi.fn(async () => backupText('888', TWO_FIVES)),
    })
    const store = useAppStore()
    await store.init()
    await runImport()

    expect(store.pendingBackupImport?.targetUid).toBe('888')
    expect(store.pendingBackupImport?.result.summary).toEqual({ added: 2, upgraded: 0, skipped: 0 })
    const hint = wrapper.find('.dialog-hint').text()
    expect(hint).toContain('888')
    expect(hint).toContain('777')
    expect(hint).toContain('档案管理')
    expect(wrapper.find('.import-summary').text()).toContain('新增 2 条')
  })

  it('取消导入:零写入(ensureArchive/insertRecords 都不调)', async () => {
    const storage = makeFakeStorage()
    const { wrapper } = mountImport(storage, {
      pickFile: vi.fn(async () => '/tmp/backup.json'),
      readTextFile: vi.fn(async () => backupText('888', TWO_FIVES)),
    })
    const store = useAppStore()
    await runImport()

    await wrapper.findAll('button').find((b) => b.text() === '取消')!.trigger('click')
    expect(store.pendingBackupImport).toBeNull()
    expect(storage.calls.ensureArchive).not.toHaveBeenCalled()
    expect(storage.calls.insertRecords).not.toHaveBeenCalled()
    expect(storage.db.has('888')).toBe(false)
  })

  it('确认导入:ensureArchive → insertRecords 落到 backup.uid 档案,当前档案不切换', async () => {
    const storage = makeFakeStorage({ '777': [storedRecord()] })
    const { wrapper } = mountImport(storage, {
      pickFile: vi.fn(async () => '/tmp/backup.json'),
      readTextFile: vi.fn(async () => backupText('888', TWO_FIVES)),
    })
    const store = useAppStore()
    await store.init()
    await runImport()

    await wrapper.findAll('button').find((b) => b.text() === '确认导入')!.trigger('click')
    await flushPromises()

    expect(storage.calls.ensureArchive).toHaveBeenCalledWith('888')
    expect(storage.calls.insertRecords).toHaveBeenCalledTimes(1)
    const [uid, rows] = storage.calls.insertRecords.mock.calls[0]!
    expect(uid).toBe('888')
    expect(rows).toHaveLength(2)
    expect(storage.db.get('888')).toHaveLength(2)
    expect(store.currentUid).toBe('777') // 不切换,提示在档案面板查看
    expect(store.message?.kind).toBe('success')
    expect(store.message?.text).toContain('新增 2 条')
    expect(store.message?.text).toContain('UID 888')
    expect(store.pendingBackupImport).toBeNull()
  })

  it('导入到当前档案:身份回填走 updateIdentity,完成文案不含切换提示', async () => {
    const seeded = storedRecord({ name: '温迪', time: '2021-01-01 00:00:00', rankType: 5, id: null })
    const storage = makeFakeStorage({ '777': [seeded] })
    const { wrapper } = mountImport(storage, {
      pickFile: vi.fn(async () => '/tmp/backup.json'),
      readTextFile: vi.fn(async () =>
        backupText('777', [
          { gachaType: 200, time: '2021-01-01 00:00:00', name: '温迪', rankType: 5, id: '1900000000000000009' },
        ]),
      ),
    })
    const store = useAppStore()
    await store.init()
    await runImport()

    expect(store.pendingBackupImport?.result.summary).toEqual({ added: 0, upgraded: 1, skipped: 1 })
    expect(wrapper.find('.import-summary').text()).toContain('回填身份(既有无 id 行) 1 条')

    await wrapper.findAll('button').find((b) => b.text() === '确认导入')!.trigger('click')
    await flushPromises()

    expect(storage.calls.insertRecords).not.toHaveBeenCalled() // 无新增
    expect(storage.calls.updateIdentity).toHaveBeenCalledTimes(1)
    const updates = storage.calls.updateIdentity.mock.calls[0]![0] as { rowid: number; id: string }[]
    expect(updates).toEqual([{ rowid: seeded.rowid, id: '1900000000000000009' }])
    expect(store.message?.text).not.toContain('切换查看')
  })

  it('64MB 门禁(Rust 读文件层拒绝):文案进 message,不挂预览', async () => {
    const { wrapper } = mountImport(undefined as never, {
      pickFile: vi.fn(async () => '/tmp/huge.json'),
      readTextFile: vi.fn(async () => {
        throw new Error('备份文件超过 64MB 大小上限(实际 67108865 字节),请确认导出的文件完整')
      }),
    })
    const store = useAppStore()
    await runImport()

    expect(store.pendingBackupImport).toBeNull()
    expect(store.message?.kind).toBe('error')
    expect(store.message?.text).toContain('64MB')
    expect(wrapper.find('[aria-label="导入备份确认"]').exists()).toBe(false)
  })

  it('版本过新拒绝:UI 呈现版本文案', async () => {
    const { wrapper } = mountImport(undefined as never, {
      pickFile: vi.fn(async () => '/tmp/backup.json'),
      readTextFile: vi.fn(async () =>
        backupText('777', TWO_FIVES, { version: BACKUP_FORMAT_VERSION + 1 }),
      ),
    })
    const store = useAppStore()
    await runImport()

    expect(store.pendingBackupImport).toBeNull()
    expect(store.message?.text).toContain('版本过新')
    expect(wrapper.find('[aria-label="导入备份确认"]').exists()).toBe(false)
  })

  it('app 标记不符拒绝:UI 呈现非本工具备份文案', async () => {
    const { wrapper } = mountImport(undefined as never, {
      pickFile: vi.fn(async () => '/tmp/backup.json'),
      readTextFile: vi.fn(async () => backupText('777', TWO_FIVES, { app: 'other' })),
    })
    const store = useAppStore()
    await runImport()

    expect(store.pendingBackupImport).toBeNull()
    expect(store.message?.text).toContain('不是原神祈愿工具箱的备份文件')
    expect(wrapper.find('[aria-label="导入备份确认"]').exists()).toBe(false)
  })

  it('取消选文件:静默返回,不报错不挂预览', async () => {
    const { wrapper } = mountImport(undefined as never)
    const store = useAppStore()
    await runImport()

    expect(store.pendingBackupImport).toBeNull()
    expect(store.message).toBeNull()
    expect(wrapper.find('[aria-label="导入备份确认"]').exists()).toBe(false)
  })
})
