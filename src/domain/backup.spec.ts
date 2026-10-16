import { describe, expect, it } from 'vitest'
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_MAX_BYTES,
  backupFileName,
  exportBackup,
  importBackup,
  parseBackup,
  type BackupFile,
} from './backup'
import { mergeRecords, type StoredRecord, type WishRecord } from './records'

const UID = '100000001'

const BASE = { gachaType: 301, time: '2026-09-23 21:14:36', name: '那维莱特', rankType: 5 }

function wish(overrides: Partial<WishRecord> = {}): WishRecord {
  return { ...BASE, id: null, ...overrides }
}

let rowidSeq = 0
function stored(overrides: Partial<StoredRecord> = {}): StoredRecord {
  rowidSeq += 1
  return { ...BASE, id: null, seq: 0, rowid: rowidSeq, ...overrides }
}

/** 覆盖五池、同秒多抽、有 id/无 id 混合态的乱序合成样本 */
function mixedRecords(): WishRecord[] {
  return [
    wish({ gachaType: 302, time: '2026-09-23 21:15:00', name: '护摩之杖', rankType: 5, id: '1790000000000000500' }),
    wish({ gachaType: 400, time: '2026-09-23 21:14:36', name: '那维莱特', rankType: 5, id: '1790000000000000002' }),
    wish({ gachaType: 100, time: '2026-09-20 08:00:00', name: '安柏', rankType: 4 }),
    wish({ gachaType: 200, time: '2026-09-21 12:30:00', name: '莫娜', rankType: 5, id: '1790000000000001000' }),
    wish({ gachaType: 301, time: '2026-09-23 21:14:36', name: '那维莱特', rankType: 5, id: '1790000000000000001' }),
    wish({ gachaType: 500, time: '2026-09-22 18:00:00', name: '白术', rankType: 5, id: '1790000000000002000' }),
    wish({ gachaType: 301, time: '2026-09-23 21:14:36', name: '西风剑', rankType: 3 }),
  ]
}

/** 全量备份文件(单条合法记录),拒绝分支用例在其上覆写单字段 */
function validFile(): BackupFile {
  return {
    app: 'genshintool',
    version: BACKUP_FORMAT_VERSION,
    uid: UID,
    exportedAt: '2026-10-16T12:00:00.000Z',
    records: [wish({ id: '1790000000000000001' })],
  }
}

/** 序列化比较口径:exportedAt 归零后逐字节比对(E11 允许导出时间不同) */
function stripExportedAt(file: BackupFile): string {
  return JSON.stringify({ ...file, exportedAt: '' })
}

describe('exportBackup(spec 01 §6)', () => {
  it('E11 往返不变式:导出→清空→重插→再导出,除 exportedAt 外逐字节等价', () => {
    const first = exportBackup(mixedRecords(), UID, '2026-10-16T12:00:00.000Z')
    // 清空→重插:备份记录作为 incoming 合并进空档案,再以不同导出时间导出
    const reinserted = mergeRecords([], first.records).records
    const second = exportBackup(reinserted, UID, '2026-10-16T18:00:00.000Z')
    expect(second.exportedAt).not.toBe(first.exportedAt)
    expect(stripExportedAt(second)).toBe(stripExportedAt(first))
  })

  it('输出按 §2 比较器权威时序排序:time 升序,同秒无 id 在前、id 数值升序', () => {
    const file = exportBackup(mixedRecords(), UID, '2026-10-16T12:00:00.000Z')
    expect(file.records.map((r) => r.name)).toEqual([
      '安柏',
      '莫娜',
      '白术',
      '西风剑',
      '那维莱特',
      '那维莱特',
      '护摩之杖',
    ])
  })

  it('不改写入参:输入数组与行对象保持原样', () => {
    const records = mixedRecords()
    const snapshot = JSON.stringify(records)
    exportBackup(records, UID, '2026-10-16T12:00:00.000Z')
    expect(JSON.stringify(records)).toBe(snapshot)
  })

  it('顶层结构与常量:app 标记、版本号、uid、注入的导出时间', () => {
    const file = exportBackup(mixedRecords(), UID, '2026-10-16T12:00:00.000Z')
    expect(file.app).toBe('genshintool')
    expect(file.version).toBe(1)
    expect(BACKUP_FORMAT_VERSION).toBe(1)
    expect(file.uid).toBe(UID)
    expect(file.exportedAt).toBe('2026-10-16T12:00:00.000Z')
    expect(file.records).toHaveLength(7)
  })
})

describe('parseBackup 校验与拒绝分支(E11)', () => {
  it('超过大小上限拒绝;上限常量为 64MB', () => {
    expect(() => parseBackup('{}', 1)).toThrow(/大小上限/)
    expect(() => parseBackup('x'.repeat(BACKUP_MAX_BYTES + 1), BACKUP_MAX_BYTES)).toThrow(/大小上限/)
    expect(BACKUP_MAX_BYTES).toBe(64 * 1024 * 1024)
  })

  it('version > 1 拒绝;version 非数字同样按版本不符拒绝', () => {
    const newer = JSON.stringify({ ...validFile(), version: BACKUP_FORMAT_VERSION + 1 })
    expect(() => parseBackup(newer, BACKUP_MAX_BYTES)).toThrow(/版本过新/)
    const badVersion = JSON.stringify({ ...validFile(), version: '1' })
    expect(() => parseBackup(badVersion, BACKUP_MAX_BYTES)).toThrow(/版本过新/)
  })

  it('app 标记不符拒绝(防误导入任意 JSON)', () => {
    const otherApp = JSON.stringify({ ...validFile(), app: 'wuwatool' })
    expect(() => parseBackup(otherApp, BACKUP_MAX_BYTES)).toThrow(/不是原神祈愿工具箱/)
    expect(() => parseBackup('null', BACKUP_MAX_BYTES)).toThrow(/不是原神祈愿工具箱/)
    expect(() => parseBackup('"记录"', BACKUP_MAX_BYTES)).toThrow(/不是原神祈愿工具箱/)
  })

  it('损坏 JSON 拒绝', () => {
    expect(() => parseBackup('{"app":"genshintool"', BACKUP_MAX_BYTES)).toThrow(/不是有效的 JSON/)
  })

  it('records 非数组拒绝', () => {
    const text = JSON.stringify({ ...validFile(), records: '那维莱特' })
    expect(() => parseBackup(text, BACKUP_MAX_BYTES)).toThrow(/记录列表/)
  })

  it('uid 缺失或空串拒绝(无法确定导入目标)', () => {
    expect(() => parseBackup(JSON.stringify({ ...validFile(), uid: '' }), BACKUP_MAX_BYTES)).toThrow(/UID/)
    expect(() => parseBackup(JSON.stringify({ ...validFile(), uid: 123 }), BACKUP_MAX_BYTES)).toThrow(/UID/)
  })

  it('非法行形状拒绝:gachaType 字符串 / rankType 越界 / id 数字 / time 空串 / name 缺失 / 行非对象', () => {
    const badRows: unknown[] = [
      { gachaType: '301', time: '2026-09-23 21:14:36', name: '那维莱特', rankType: 5, id: null },
      { gachaType: 301, time: '2026-09-23 21:14:36', name: '那维莱特', rankType: 6, id: null },
      { gachaType: 301, time: '2026-09-23 21:14:36', name: '那维莱特', rankType: 5, id: 179 },
      { gachaType: 301, time: '2026-09-23 21:14:36', name: '那维莱特', rankType: 5 },
      { gachaType: 301, time: '', name: '那维莱特', rankType: 5, id: null },
      { gachaType: 301, time: '2026-09-23 21:14:36', rankType: 5, id: null },
      '那维莱特',
    ]
    for (const row of badRows) {
      const text = JSON.stringify({ ...validFile(), records: [row] })
      expect(() => parseBackup(text, BACKUP_MAX_BYTES)).toThrow(/记录/)
    }
  })

  it('合法文件解析通过,自家导出→parse 深等价(含 id 为 null 的迁入行)', () => {
    const file = exportBackup(mixedRecords(), UID, '2026-10-16T12:00:00.000Z')
    expect(parseBackup(JSON.stringify(file), BACKUP_MAX_BYTES)).toEqual(file)
  })
})

describe('backupFileName(spec 01 §6)', () => {
  it('格式 genshintool-backup-<uid>-<yyyyMMdd-HHmmss>.json,月日时分秒补零', () => {
    expect(backupFileName('100000001', new Date(2026, 0, 2, 3, 4, 5))).toBe(
      'genshintool-backup-100000001-20260102-030405.json',
    )
    expect(backupFileName('0', new Date(2026, 9, 16, 21, 14, 36))).toBe(
      'genshintool-backup-0-20261016-211436.json',
    )
  })
})

describe('importBackup(合并入档案,spec 01 §6)', () => {
  it('新增/回填/跳过计数正确,合并语义与 mergeRecords 一致', () => {
    const existing = [
      stored({ time: '2026-09-23 21:14:36', name: '那维莱特', rankType: 5 }),
      stored({ time: '2026-09-23 21:14:37', name: '行秋', rankType: 4 }),
      stored({ time: '2026-09-23 21:14:37', name: '行秋', rankType: 4, seq: 1 }),
    ]
    const backup: BackupFile = {
      app: 'genshintool',
      version: 1,
      uid: UID,
      exportedAt: '2026-10-16T12:00:00.000Z',
      records: [
        wish({ time: '2026-09-23 21:14:36', name: '那维莱特', rankType: 5, id: '1790000000000000001' }),
        wish({ time: '2026-09-23 21:14:38', name: '妮露', rankType: 5, id: '1790000000000000003' }),
        wish({ time: '2026-09-23 21:14:37', name: '行秋', rankType: 4 }),
      ],
    }
    const result = importBackup(existing, backup)
    expect(result.summary).toEqual({ added: 1, upgraded: 1, skipped: 2 })
    expect(result.added).toHaveLength(1)
    expect(result.upgrades).toEqual([{ rowid: 1, id: '1790000000000000001' }])
    expect(result.records).toHaveLength(4)
  })

  it('空档案导入:全部计新增,skipped = 0', () => {
    const backup = exportBackup(mixedRecords(), UID, '2026-10-16T12:00:00.000Z')
    const result = importBackup([], backup)
    expect(result.summary).toEqual({ added: 7, upgraded: 0, skipped: 0 })
    expect(result.records).toHaveLength(7)
  })
})
