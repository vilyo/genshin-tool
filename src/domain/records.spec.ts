import { describe, expect, it } from 'vitest'
import { poolCategory } from './pools'
import { compareRecords, mergeRecords, type StoredRecord, type WishRecord } from './records'

const BASE = { gachaType: 301, time: '2026-09-23 21:14:36', name: '那维莱特', rankType: 5 }

function wish(overrides: Partial<WishRecord> = {}): WishRecord {
  return { ...BASE, id: null, ...overrides }
}

let rowidSeq = 0
function stored(overrides: Partial<StoredRecord> = {}): StoredRecord {
  rowidSeq += 1
  return { ...BASE, id: null, seq: 0, rowid: rowidSeq, ...overrides }
}

/** 按自然键统计份数(E2 断言用;口径与实现一致:poolCategory 使 301/400 同桶) */
function countByKey(records: readonly WishRecord[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const record of records) {
    const key = `${poolCategory(record.gachaType)}|${record.time}|${record.name}|${record.rankType}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

describe('compareRecords(全库统一时序,spec 01 §2)', () => {
  it('E7:time 字符串升序,不同秒时直接定序', () => {
    const earlier = stored({ time: '2026-09-23 21:14:35', id: '1790000000000000009' })
    const later = stored({ time: '2026-09-23 21:14:36', id: '1790000000000000001' })
    expect(compareRecords(earlier, later)).toBe(-1)
    expect(compareRecords(later, earlier)).toBe(1)
  })

  it('E7:同秒时无 id 行排在前(纯迁入行在同秒最前)', () => {
    const noId = stored({})
    const withId = stored({ id: '1790000000000000001' })
    expect(compareRecords(noId, withId)).toBe(-1)
    expect(compareRecords(withId, noId)).toBe(1)
  })

  it('E7:同秒均有 id 按 id 数值升序', () => {
    const small = stored({ id: '1790000000000000001' })
    const large = stored({ id: '1790000000000000002' })
    expect(compareRecords(small, large)).toBe(-1)
    expect(compareRecords(large, small)).toBe(1)
  })

  it('E7:同秒均无 id 按 seq 升序;任一侧无 seq(如 incoming 行)视为相等', () => {
    expect(compareRecords(stored({ seq: 0 }), stored({ seq: 1 }))).toBe(-1)
    expect(compareRecords(stored({ seq: 1 }), stored({ seq: 0 }))).toBe(1)
    expect(compareRecords(wish({}), wish({}))).toBe(0)
  })

  it('E8:19 位 id 严格数值序,BigInt 防御 Number 失精', () => {
    // 这对 19 位 id 的 Number() 已坍缩为同一个值,只有 BigInt 能分辨
    expect(Number('8999999999999999999')).toBe(Number('9000000000000000000'))
    expect(compareRecords(stored({ id: '8999999999999999999' }), stored({ id: '9000000000000000000' }))).toBe(-1)
    expect(compareRecords(stored({ id: '9000000000000000000' }), stored({ id: '8999999999999999999' }))).toBe(1)
    // 前缀相同、末位相邻:同秒内相邻两抽的分辨力
    expect(compareRecords(stored({ id: '1790000000000009998' }), stored({ id: '1790000000000009999' }))).toBe(-1)
  })

  it('比较器不比 name:同秒同 seq 视为相等,排序对相等元素保持稳定(不交换)', () => {
    const a = stored({ name: '行秋', rankType: 4, seq: 2 })
    const b = stored({ name: '西风剑', rankType: 4, seq: 2 })
    expect(compareRecords(a, b)).toBe(0)
    const sorted = [b, a].sort(compareRecords)
    expect(sorted[0]).toBe(b)
    expect(sorted[1]).toBe(a)
  })
})

describe('mergeRecords(spec 01 §3)', () => {
  it('E1 幂等:同一批数据重复合并,added/upgrades 为空,records 不变', () => {
    const existing = [
      stored({ id: '1790000000000000001' }),
      stored({ time: '2026-09-23 21:14:37', name: '行秋', rankType: 4 }),
      stored({ time: '2026-09-23 21:14:37', name: '行秋', rankType: 4, seq: 1 }),
    ]
    const incoming = [
      wish({ id: '1790000000000000001' }),
      wish({ time: '2026-09-23 21:14:37', name: '行秋', rankType: 4 }),
      wish({ time: '2026-09-23 21:14:37', name: '行秋', rankType: 4, gachaType: 400 }),
    ]
    const { records, added, upgrades } = mergeRecords(existing, incoming)
    expect(added).toEqual([])
    expect(upgrades).toEqual([])
    expect(records).toEqual(existing)
  })

  it('E2 只增不减:每自然键份数 = max(既有, 迁入),既有行全保留', () => {
    const existing = [
      stored({ id: '1790000000000000001' }), // 键 K1 ×1
      stored({ time: '2026-09-23 21:14:37', name: '行秋', rankType: 4 }), // 键 K2 ×2(无 id)
      stored({ time: '2026-09-23 21:14:37', name: '行秋', rankType: 4, seq: 1 }),
    ]
    const incoming = [
      wish({ id: '1790000000000000001' }), // K1 重复
      wish({ time: '2026-09-23 21:14:37', name: '行秋', rankType: 4 }), // K2 份数闸门内,重复
      wish({ time: '2026-09-23 21:14:37', name: '行秋', rankType: 4 }),
      wish({ time: '2026-09-23 21:14:37', name: '行秋', rankType: 4 }), // K2 第 3 份 > mult → 新增
    ]
    const { records, added } = mergeRecords(existing, incoming)
    expect(added).toHaveLength(1)
    expect(records).toEqual([...existing, added[0]])
    expect(countByKey(records).get('eventChar|2026-09-23 21:14:36|那维莱特|5')).toBe(1)
    expect(countByKey(records).get('eventChar|2026-09-23 21:14:37|行秋|4')).toBe(3) // max(2, 3)
  })

  it('E3 同键多抽:同秒同名同星 N 抽保留 N 行,不合并也不丢弃', () => {
    // 接口侧:十连出双四星同名,两份 id 各异,是合法形态
    const incoming = [
      wish({ id: '1790000000000000101', name: '行秋', rankType: 4 }),
      wish({ id: '1790000000000000102', name: '行秋', rankType: 4 }),
    ]
    const withIds = mergeRecords([], incoming)
    expect(withIds.added).toEqual(incoming)
    expect(withIds.records).toHaveLength(2)

    // 迁入侧:既有 1 份,再迁入同键 2 份 → 补齐为 2 行
    const existing = [stored({ name: '西风剑', rankType: 4 })]
    const noIdIncoming = [
      wish({ name: '西风剑', rankType: 4 }),
      wish({ name: '西风剑', rankType: 4 }),
    ]
    const noIds = mergeRecords(existing, noIdIncoming)
    expect(noIds.records).toHaveLength(2)
    expect(noIds.added).toEqual([noIdIncoming[1]])
  })

  it('E4 回填单向:既有有 id 时迁入行按重复丢弃,永不降级', () => {
    const existing = [stored({ id: '1790000000000000001' })]
    const incoming = [
      wish({ id: '1790000000000000001', gachaType: 400 }), // 同 id 不同 code:仍按精确 id 判重
      wish({ id: '1790000000000000002', time: '2026-09-23 21:14:37', name: '迪卢克' }),
    ]
    const { records, added, upgrades } = mergeRecords(existing, incoming)
    expect(upgrades).toEqual([])
    expect(added.map((r) => r.id)).toEqual(['1790000000000000002'])
    expect(records[0]).toBe(existing[0]) // 既有行原样保留,身份与 code 不被改写
    expect(records).toHaveLength(2)
  })

  it('E4 回填单向:无 id 迁入行永不触发回填', () => {
    const existing = [stored({}), stored({ seq: 1 })]
    const incoming = [wish({}), wish({})]
    const { upgrades, added } = mergeRecords(existing, incoming)
    expect(upgrades).toEqual([])
    expect(added).toEqual([])
  })

  it('E5 类别合并:Excel(301) 与接口(400) 同自然键为同一抽,份数互抵且身份回填', () => {
    const existing = [stored({ gachaType: 301 })] // Excel 行无 id
    const incoming = [wish({ gachaType: 400, id: '1790000000000000001' })] // 接口行
    const { records, added, upgrades } = mergeRecords(existing, incoming)
    expect(added).toEqual([])
    expect(upgrades).toHaveLength(1)
    expect(records).toHaveLength(1)
  })

  it('E5 双方都无 id 时按类别互抵,行内 code 各自保留', () => {
    const existing = [stored({ gachaType: 301 })]
    const incoming = [wish({ gachaType: 400 })]
    const { records, added, upgrades } = mergeRecords(existing, incoming)
    expect(added).toEqual([])
    expect(upgrades).toEqual([])
    expect(records[0].gachaType).toBe(301)
  })

  it('E5 对照:类别不同(301 vs 302)的同秒同名同星是不同抽', () => {
    const existing = [stored({ gachaType: 301, name: '西风剑', rankType: 4 })]
    const incoming = [wish({ gachaType: 302, name: '西风剑', rankType: 4, id: '1790000000000000001' })]
    const { records, added } = mergeRecords(existing, incoming)
    expect(added).toHaveLength(1)
    expect(records).toHaveLength(2)
  })

  it('E6 升级纠偏:回填同时把类别内 code 改为接口权威值(301↔400)', () => {
    const existing = [stored({ gachaType: 400 })] // Excel 备注「祈愿2」错标
    const incoming = [wish({ gachaType: 301, id: '1790000000000000001' })]
    const { records, upgrades } = mergeRecords(existing, incoming)
    expect(upgrades).toEqual([{ rowid: existing[0].rowid, id: '1790000000000000001', gachaType: 301 }])
    expect(records[0].id).toBe('1790000000000000001')
    expect(records[0].gachaType).toBe(301)
  })

  it('E6 同 code 回填不带 gachaType 纠偏', () => {
    const existing = [stored({ gachaType: 302, name: '护摩之杖' })]
    const incoming = [wish({ gachaType: 302, name: '护摩之杖', id: '1790000000000000001' })]
    const { records, upgrades } = mergeRecords(existing, incoming)
    expect(upgrades).toEqual([{ rowid: existing[0].rowid, id: '1790000000000000001' }])
    expect(records[0].id).toBe('1790000000000000001')
    expect(records[0].gachaType).toBe(302)
    expect('gachaType' in upgrades[0]).toBe(false)
  })

  it('E14① 混合态:新 id 恰好回填到无 id 份,不错配不漏配', () => {
    const identified = stored({ id: '1790000000000000001', seq: 0 })
    const unidentified = stored({ seq: 1 }) // 同键另一抽,Excel 来源无 id
    const existing = [identified, unidentified]
    const incoming = [
      wish({ id: '1790000000000000001' }), // 已在库,跳过
      wish({ id: '1790000000000000002' }), // 未命中 → 回填到无 id 份
    ]
    const { records, added, upgrades } = mergeRecords(existing, incoming)
    expect(added).toEqual([])
    expect(upgrades).toEqual([{ rowid: unidentified.rowid, id: '1790000000000000002' }])
    expect(records).toHaveLength(2)
    expect(records[0].id).toBe('1790000000000000001')
    expect(records[1].id).toBe('1790000000000000002')
    // 回填行即原无 id 份:seq/rowid 原样保留
    expect(records[1]).toEqual({ ...unidentified, id: '1790000000000000002' })
  })

  it('E14① 三份部分回填态:只有剩余未回填份被配对', () => {
    const existing = [
      stored({ id: '1790000000000000001', seq: 0 }),
      stored({ id: '1790000000000000002', seq: 1 }),
      stored({ seq: 2 }),
    ]
    const incoming = [
      wish({ id: '1790000000000000001' }),
      wish({ id: '1790000000000000002' }),
      wish({ id: '1790000000000000003' }),
    ]
    const { records, added, upgrades } = mergeRecords(existing, incoming)
    expect(added).toEqual([])
    expect(upgrades).toEqual([{ rowid: existing[2].rowid, id: '1790000000000000003' }])
    expect(records.map((r) => r.id)).toEqual([
      '1790000000000000001',
      '1790000000000000002',
      '1790000000000000003',
    ])
  })

  it('E14② 同键既有 [id_B]、incoming 升序 [id_A, id_B](十连同名同星跨页):A 新增、B 跳过,不丢行', () => {
    const existing = [stored({ id: '1790000000000000002', seq: 0 })]
    const incoming = [wish({ id: '1790000000000000001' }), wish({ id: '1790000000000000002' })]
    const { records, added } = mergeRecords(existing, incoming)
    expect(added.map((r) => r.id)).toEqual(['1790000000000000001'])
    expect(records).toHaveLength(2)
    expect(records.map((r) => r.id)).toEqual(['1790000000000000002', '1790000000000000001'])
  })

  it('E14③ 无 id 迁入超出既有份数:超出部分新增,份数 = max', () => {
    const existing = [
      stored({ id: '1790000000000000001' }),
      stored({ time: '2026-09-23 21:14:37', name: '行秋', rankType: 4 }),
    ]
    const incoming = [
      wish({ time: '2026-09-23 21:14:37', name: '行秋', rankType: 4 }),
      wish({ time: '2026-09-23 21:14:37', name: '行秋', rankType: 4 }),
      wish({ time: '2026-09-23 21:14:37', name: '行秋', rankType: 4 }),
    ]
    const { records, added } = mergeRecords(existing, incoming)
    expect(added).toEqual([incoming[1], incoming[2]])
    expect(countByKey(records).get('eventChar|2026-09-23 21:14:37|行秋|4')).toBe(3)
  })

  it('回填队列组内按 §2 比较器排序:有 id 迁入与无 id 份按各自序内第 k 个对齐', () => {
    const first = stored({ seq: 0 })
    const second = stored({ seq: 1 })
    const existing = [second, first] // 故意乱序给出
    const incoming = [wish({ id: '1790000000000000001' }), wish({ id: '1790000000000000002' })]
    const { records, upgrades } = mergeRecords(existing, incoming)
    expect(upgrades).toEqual([
      { rowid: first.rowid, id: '1790000000000000001' },
      { rowid: second.rowid, id: '1790000000000000002' },
    ])
    // records 保持既有在前(入参序),回填只改身份不改位置
    expect(records.map((r) => r.id)).toEqual(['1790000000000000002', '1790000000000000001'])
  })

  it('输出契约:既有在前、新增按 incoming 序追加,不改写入参', () => {
    const existing = [
      stored({ id: '1790000000000000001' }),
      stored({ time: '2026-09-23 21:14:37', name: '行秋', rankType: 4 }),
    ]
    const incoming = [
      wish({ id: '1790000000000000001' }), // 重复
      wish({ time: '2026-09-23 21:14:37', name: '行秋', rankType: 4 }), // 重复
      wish({ id: '1790000000000000002', time: '2026-09-23 21:14:38' }),
    ]
    const existingBefore = structuredClone(existing)
    const incomingBefore = structuredClone(incoming)
    const { records, added } = mergeRecords(existing, incoming)
    expect(added.map((r) => r.id)).toEqual(['1790000000000000002'])
    expect(records).toEqual([...existing, added[0]])
    expect(existing).toEqual(existingBefore)
    expect(incoming).toEqual(incomingBefore)
  })

  it('防御:incoming 未按升序给出时,输出仍按比较器序处理与追加', () => {
    const incoming = [wish({ id: '1790000000000000002' }), wish({ id: '1790000000000000001' })]
    const { records, added } = mergeRecords([], incoming)
    expect(added.map((r) => r.id)).toEqual(['1790000000000000001', '1790000000000000002'])
    expect(records.map((r) => r.id)).toEqual(['1790000000000000001', '1790000000000000002'])
  })
})
