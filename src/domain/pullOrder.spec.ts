import { describe, expect, it } from 'vitest'
import { computePoolStats } from './stats'
import { buildRoster } from './roster'
import { buildHighlights } from './highlights'
import { exportBackup, parseBackup, BACKUP_MAX_BYTES } from './backup'
import { mergeRecords, type StoredRecord, type WishRecord } from './records'
import { makeRows, makeSheet, makeWorkbook, FIXTURE_SHEETS } from './excelFixture'
import { parseWorkbook } from './excelImport'
import type { PoolCategory } from './pools'

/** 模拟实际入库:重复份数只按自然键计数,抽序由插入次序保存。 */
function store(records: WishRecord[]): StoredRecord[] {
  const counts = new Map<string, number>()
  return records.map((record, index) => {
    const key = JSON.stringify([record.gachaType, record.time, record.name, record.rankType])
    const seq = counts.get(key) ?? 0
    counts.set(key, seq + 1)
    return { ...record, seq, rowid: index + 1 }
  })
}
const scopes: PoolCategory[] = ['eventChar', 'eventWeapon', 'standard', 'chronicled', 'novice']
const codes = [301, 302, 200, 500, 100]

describe('单抽和同秒十连抽序', () => {
  it.each(scopes)('%s:五星位于十连任一位置,重复物品不得改变抽数', (scope) => {
    const code = codes[scopes.indexOf(scope)]!
    for (let position = 1; position <= 10; position++) {
      const records = store(Array.from({ length: 11 }, (_, i) => ({
        gachaType: code, id: null,
        time: i === 0 ? '2026-01-01 00:00:00' : '2026-01-01 00:00:01',
        name: i === position ? '测试五星' : '重复武器',
        rankType: i === position ? 5 : 3,
      })))
      const stats = computePoolStats(scope, [...records].reverse())
      expect(stats.fives[0]?.pulls).toBe(position + 1) // 单抽 + 十连内位置
      expect(stats.avgPulls).toBe(position + 1)
      expect(stats.fourPity.current).toBe(10 - position)
      if (stats.pity) expect(stats.pity.current).toBe(10 - position)
    }
  })

  it('同秒十连含两个五星:分别重置,四星不重置五星,301/400 合并', () => {
    const rows = makeRows(Array.from({ length: 12 }, (_, i) => ({
      // 单抽、十连、单抽。五星在总第 4/8 抽,四星在总第 10 抽。
      time: i === 0 ? '2026-01-01 00:00:00' : i === 11 ? '2026-01-01 00:00:02' : '2026-01-01 00:00:01',
      name: i === 3 ? '迪卢克' : i === 7 ? '温迪' : i === 9 ? '行秋' : '重复武器',
      rank: i === 3 || i === 7 ? 5 : i === 9 ? 4 : 3,
      category: i === 3 || i === 7 || i === 9 ? '角色' : '武器',
      remark: i % 2 === 0 ? '祈愿2' : null,
    })))
    const parsed = parseWorkbook(makeWorkbook([makeSheet(FIXTURE_SHEETS.eventChar, rows)]))
    const records = store(parsed.records)
    const stats = computePoolStats('eventChar', records)
    expect(stats.fives.map(f => f.pulls)).toEqual([4, 4])
    expect(stats.avgPulls).toBe(4)
    expect(stats.avgUpPulls).toBe(8)
    expect(stats.offRate).toBe(0.5)
    expect(stats.guarantee).toBe('fiftyFifty')
    expect(stats.pity?.current).toBe(4)
    expect(stats.fourPity.current).toBe(2)
    expect(buildRoster('eventChar', records).cards.map(c => c.acquisitions[0]?.pulls)).toEqual([4, 4])
    expect(buildHighlights(records).fastest).toMatchObject({ name: '温迪', pulls: 4 })
  })

  it('API 同秒记录分批倒序返回:按 19 位 id 排序而非入库顺序', () => {
    const api = Array.from({ length: 20 }, (_, i) => ({
      gachaType: i % 2 ? 400 : 301,
      time: '2026-01-01 00:00:00',
      name: i === 1 || i === 15 ? '温迪' : '重复武器',
      rankType: i === 1 || i === 15 ? 5 : 3,
      id: String(1900000000000000000n + BigInt(i)),
    }))
    const firstPage = store(mergeRecords([], api.slice(10).reverse()).added)
    const secondPage = mergeRecords(firstPage, api.slice(0, 10).reverse()).added
    const records = store([...firstPage, ...secondPage])
    const stats = computePoolStats('eventChar', records)
    expect(stats.fives.map(f => f.pulls)).toEqual([2, 14])
    expect(stats.pity?.current).toBe(4)
    expect(stats.totalPulls).toBe(20) // 同秒不折叠成一条,不猜十连边界
  })

  it('备份先按导入序排序再剥离元数据,重新导入和重复导入都保留同秒多五星抽序', () => {
    const records = store(Array.from({ length: 10 }, (_, i) => ({
      gachaType: 301, id: null, time: '2026-01-01 00:00:00',
      name: i === 2 || i === 5 ? '温迪' : '重复武器',
      rankType: i === 2 || i === 5 ? 5 : 3,
    })))
    const backup = exportBackup([...records].reverse(), 'test', '2026-01-01T00:00:00Z')
    expect(backup.records[0]).not.toHaveProperty('rowid')
    expect(backup.records[0]).not.toHaveProperty('seq')
    const restored = store(parseBackup(JSON.stringify(backup), BACKUP_MAX_BYTES).records)
    expect(computePoolStats('eventChar', restored).fives.map(f => f.pulls)).toEqual([3, 3])
    expect(computePoolStats('eventChar', restored).pity?.current).toBe(4)
    expect(mergeRecords(restored, backup.records).added).toEqual([])
    expect(exportBackup(restored, 'test', backup.exportedAt)).toEqual(backup)
  })
})
