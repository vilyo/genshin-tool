import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backupFileName, parseBackup, BACKUP_MAX_BYTES } from '@/domain/backup'
import type { FileSaveSpec } from '@/services/dialogs'
import { setAppDeps, useAppStore } from '@/stores/app'
import { makeFakeStorage, storedRecord } from '@/test-support/appFakes'

function mountStore(storage = makeFakeStorage(), deps: Record<string, unknown> = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  setAppDeps({
    storage: storage.storage,
    listGameDirs: vi.fn(async () => []),
    pickFile: vi.fn(async () => null),
    saveFile: vi.fn<(spec: FileSaveSpec) => Promise<string | null>>(async () => null),
    writeTextFile: vi.fn<(path: string, contents: string) => Promise<number>>(async () => 0),
    readTextFile: vi.fn<() => Promise<string>>(async () => ''),
    pickDirectory: vi.fn<() => Promise<string | null>>(async () => null),
    ...deps,
  })
  return { storage }
}

afterEach(() => {
  setAppDeps(null)
  localStorage.clear()
})

describe('备份导出编排(T18,F4 / spec 01 §6)', () => {
  it('无档案导出:提示先建档,不弹保存对话框', async () => {
    const saveFile = vi.fn<(spec: FileSaveSpec) => Promise<string | null>>(async () => '/tmp/x.json')
    mountStore(makeFakeStorage(), { saveFile })
    const store = useAppStore()
    await store.init()

    await store.exportBackupFile()

    expect(store.message?.kind).toBe('error')
    expect(store.message?.text).toContain('尚无祈愿档案')
    expect(saveFile).not.toHaveBeenCalled()
  })

  it('导出成功:默认文件名 genshintool-backup-<uid>-<时间戳>.json;落盘内容经 parseBackup 与当前档案逐字段相等(E11 延伸)', async () => {
    const rows = [
      storedRecord({ gachaType: 301, time: '2026-03-01 10:00:00', name: '那维莱特', rankType: 5, id: '1900000000000000003' }),
      storedRecord({ gachaType: 200, time: '2026-03-02 10:00:00', name: '天空之翼', rankType: 5, id: '1900000000000000004' }),
    ]
    const saveFile = vi.fn<(spec: FileSaveSpec) => Promise<string | null>>(async () => '/tmp/export-target.json')
    const writeTextFile = vi.fn<(path: string, contents: string) => Promise<number>>(async () => 0)
    mountStore(makeFakeStorage({ '777': rows }), { saveFile, writeTextFile })
    const store = useAppStore()
    await store.init()

    await store.exportBackupFile()

    expect(saveFile).toHaveBeenCalledTimes(1)
    const spec = saveFile.mock.calls[0]![0]
    // 默认名 = backupFileName(uid, 保存时刻):同 uid 前缀 + 时间戳形状
    expect(spec.defaultPath).toMatch(/^genshintool-backup-777-\d{8}-\d{6}\.json$/)
    expect(backupFileName('777', new Date())).toMatch(/^genshintool-backup-777-\d{8}-\d{6}\.json$/)
    expect(spec.title).toBe('导出祈愿记录备份')

    expect(writeTextFile).toHaveBeenCalledWith('/tmp/export-target.json', expect.any(String))
    const text = writeTextFile.mock.calls[0]![1]
    const backup = parseBackup(text, BACKUP_MAX_BYTES)
    expect(backup.uid).toBe('777')
    // 存储层字段不入备份(spec 01 §6:records = WishRecord 全字段,rowid/seq 不导出)
    expect(backup.records[0]).not.toHaveProperty('seq')
    expect(backup.records[0]).not.toHaveProperty('rowid')
    // 往返:E11 延伸——记录集与导出前逐字段相等(WishRecord 五字段)
    expect(backup.records).toEqual(
      rows.map(({ gachaType, time, name, rankType, id }) => ({ gachaType, time, name, rankType, id })),
    )
    expect(store.message?.kind).toBe('success')
    expect(store.message?.text).toContain('已导出 2 条')
    expect(store.message?.text).toContain('/tmp/export-target.json')
  })

  it('取消保存对话框:静默返回,不写文件、不报错', async () => {
    const writeTextFile = vi.fn<(path: string, contents: string) => Promise<number>>(async () => 0)
    mountStore(makeFakeStorage({ '777': [storedRecord()] }), { writeTextFile })
    const store = useAppStore()
    await store.init()

    await store.exportBackupFile()

    expect(writeTextFile).not.toHaveBeenCalled()
    expect(store.message).toBeNull()
  })

  it('写盘失败:错误文案进 message', async () => {
    mountStore(
      makeFakeStorage({ '777': [storedRecord()] }),
      {
        saveFile: vi.fn<(spec: FileSaveSpec) => Promise<string | null>>(async () => '/tmp/export-target.json'),
        writeTextFile: vi.fn<(path: string, contents: string) => Promise<number>>(async () => {
          throw new Error('磁盘已满')
        }),
      },
    )
    const store = useAppStore()
    await store.init()

    await store.exportBackupFile()

    expect(store.message?.kind).toBe('error')
    expect(store.message?.text).toContain('导出备份失败')
    expect(store.message?.text).toContain('磁盘已满')
  })
})
