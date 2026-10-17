import { describe, expect, it } from 'vitest'
import type { WishRecord } from './records'
import { computePoolStats, scopeRecords } from './stats'

/**
 * 测试工厂:time 以「2022-08-01 + minute 分钟」生成(同日字典序=时间序,分钟序号即时间序)。
 * 全部取 2022-08(早于 3.1 上线日 2022-09-28):「提纳里」恒判 UP(off:false 且不置 stale),
 * 1.0 名单成员(迪卢克/刻晴/莫娜)恒判歪(off:true),便于逐值手工核算。
 */
function rec(gachaType: number, minute: number, name: string, rankType: number): WishRecord {
  const hh = String(Math.floor(minute / 60)).padStart(2, '0')
  const mm = String(minute % 60).padStart(2, '0')
  return { gachaType, time: `2022-08-01 ${hh}:${mm}:00`, name, rankType, id: null }
}

/** n 条三星垫刀(分钟自 from 起连号) */
function fillers(gachaType: number, from: number, n: number): WishRecord[] {
  return Array.from({ length: n }, (_, i) => rec(gachaType, from + i, '三星武器', 3))
}

describe('scopeRecords 作用域过滤与排序(T16/UI 复用的辅助)', () => {
  it('按 PoolCategory 过滤并按比较器升序,不改写入参', () => {
    const input = [
      rec(400, 5, '四星武器', 4),
      rec(200, 1, '常驻四星', 4),
      rec(301, 9, '刻晴', 5),
      rec(301, 3, '三星武器', 3),
      rec(400, 7, '迪卢克', 5),
    ]
    const snapshot = [...input]
    const scoped = scopeRecords(input, 'eventChar')
    expect(scoped.map((r) => r.time)).toEqual([
      '2022-08-01 00:03:00',
      '2022-08-01 00:05:00',
      '2022-08-01 00:07:00',
      '2022-08-01 00:09:00',
    ])
    expect(input).toEqual(snapshot)
  })

  it('未知 code 兜底进 unknown 作用域', () => {
    const input = [rec(1000, 0, '颂愿五星', 5), rec(301, 1, '刻晴', 5)]
    expect(scopeRecords(input, 'unknown').map((r) => r.gachaType)).toEqual([1000])
  })
})

describe('H1 301/400 交错合并(DoD 用例)', () => {
  /** 手工核算序列(分钟序):m0..m15,五星在 m2/m5/m15,四星在 m7 */
  function interleaved(): WishRecord[] {
    return [
      rec(301, 0, '三星武器', 3),
      rec(400, 1, '三星武器', 3),
      rec(301, 2, '迪卢克', 5), // 五星① pulls=3,歪
      rec(400, 3, '三星武器', 3),
      rec(301, 4, '三星武器', 3),
      rec(400, 5, '提纳里', 5), // 五星② pulls=3,UP(3.1 前)→ 闭组
      rec(301, 6, '三星武器', 3),
      rec(400, 7, '祭礼剑', 4),
      rec(301, 8, '三星武器', 3),
      rec(400, 9, '三星武器', 3),
      rec(301, 10, '三星武器', 3),
      rec(400, 11, '三星武器', 3),
      rec(301, 12, '三星武器', 3),
      rec(400, 13, '三星武器', 3),
      rec(301, 14, '三星武器', 3),
      rec(301, 15, '刻晴', 5), // 五星③ pulls=10,歪 → 开组未闭,丢弃
    ]
  }

  it('合并统计与手工核算一致,明细 code 保留', () => {
    const stats = computePoolStats('eventChar', interleaved())
    expect(stats.scope).toBe('eventChar')
    expect(stats.codes).toEqual([301, 400])
    expect(stats.totalPulls).toBe(16)
    expect(stats.fives.map((f) => [f.record.gachaType, f.pulls, f.off])).toEqual([
      [301, 3, true],
      [400, 3, false],
      [301, 10, true],
    ])
    // 全部五星:迪卢克 3 + 提纳里 3 + 刻晴 10 → 16/3
    expect(stats.avgPulls).toBeCloseTo(16 / 3, 12)
    // 迪卢克歪开组 + 提纳里闭组 = 6;刻晴开组未闭 → 丢弃
    expect(stats.avgUpPulls).toBe(6)
    // 歪率:迪卢克 T + 提纳里 F + 刻晴 T → 2/3(首个五星计入分母)
    expect(stats.offRate).toBeCloseTo(2 / 3, 12)
    expect(stats.pity).toEqual({ current: 0, hard: 90, softFrom: 74 })
    expect(stats.fourPity).toEqual({ current: 0 }) // m15 五星把四星计数一并清零
    expect(stats.guarantee).toBe('guaranteed') // 末个五星(刻晴)歪 → 大保底就绪
    expect(stats.rosterStale).toBeUndefined() // 常驻池无名单外五星,池级旗标不置(T17 返工口径)
  })

  it('乱序入参结果不变(内部按比较器升序)', () => {
    const scrambled = [...interleaved()].reverse()
    const stats = computePoolStats('eventChar', scrambled)
    expect(stats.totalPulls).toBe(16)
    expect(stats.fives.map((f) => f.record.name)).toEqual(['迪卢克', '提纳里', '刻晴'])
  })

  it('同序列单查 301 结果不同(证合并:400 记录参与保底/歪率/五星序列)', () => {
    const only301 = interleaved().filter((r) => r.gachaType === 301)
    const stats = computePoolStats('eventChar', only301)
    expect(stats.codes).toEqual([301])
    expect(stats.totalPulls).toBe(9)
    expect(stats.fives).toHaveLength(2) // 提纳里(400)不在此作用域序列
    expect(stats.fives.map((f) => f.pulls)).toEqual([2, 7])
    expect(stats.offRate).toBe(1) // 只剩迪卢克 T + 刻晴 T
  })
})

describe('H3 首个五星边界(2026-10-18 裁决:首个五星按档案数据如实计入)', () => {
  it('首条四星、首个五星在第 3 条:计入均值与 UP 组', () => {
    const records = [
      rec(301, 0, '四星武器', 4), // 首条四星(k>0 形态)
      rec(301, 1, '三星武器', 3),
      rec(301, 2, '迪卢克', 5), // 五星① pulls=3,歪
      ...fillers(301, 3, 5),
      rec(301, 8, '提纳里', 5), // 五星② pulls=6,UP → 闭组
    ]
    const stats = computePoolStats('eventChar', records)
    expect(stats.fives.map((f) => [f.pulls, f.off])).toEqual([
      [3, true],
      [6, false],
    ])
    expect(stats.avgPulls).toBe(4.5) // (3+6)/2
    expect(stats.avgUpPulls).toBe(9) // 歪 3 + 必中 6
    expect(stats.offRate).toBe(0.5) // 1/2
    expect(stats.guarantee).toBe('fiftyFifty')
  })

  it('首条即五星的退化形态同规则(pulls=1)', () => {
    const records = [
      rec(301, 0, '迪卢克', 5), // 五星① pulls=1,歪
      rec(301, 1, '提纳里', 5), // 五星② pulls=1,UP → 组 pulls=2
    ]
    const stats = computePoolStats('eventChar', records)
    expect(stats.fives.map((f) => f.pulls)).toEqual([1, 1])
    expect(stats.avgPulls).toBe(1)
    expect(stats.avgUpPulls).toBe(2)
    expect(stats.offRate).toBe(0.5)
  })

  it('仅一个五星:avgPulls 照算,歪开组未闭 avgUpPulls 为 null', () => {
    const stats = computePoolStats('eventChar', [rec(301, 0, '迪卢克', 5)])
    expect(stats.fives).toHaveLength(1)
    expect(stats.avgPulls).toBe(1)
    expect(stats.avgUpPulls).toBeNull()
    expect(stats.offRate).toBe(1)
  })
})

describe('H4 UP 分组(歪+必中合并;未闭合歪丢弃)', () => {
  it('分组与手工核算一致', () => {
    const records = [
      rec(400, 0, '迪卢克', 5), // ① pulls=1 歪 → 开组
      rec(301, 1, '三星武器', 3),
      rec(301, 2, '三星武器', 3),
      rec(301, 3, '提纳里', 5), // ② pulls=3 UP → 组1=1+3=4
      ...fillers(301, 4, 3),
      rec(400, 7, '刻晴', 5), // ③ pulls=4 歪 → 开组
      ...fillers(301, 8, 5),
      rec(301, 13, '提纳里', 5), // ④ pulls=6 UP → 组2=4+6=10
      rec(400, 14, '三星武器', 3),
      rec(301, 15, '三星武器', 3),
      rec(400, 16, '提纳里', 5), // ⑤ pulls=3 UP,直接 UP 自成一组 → 组3=3
      ...fillers(301, 17, 4),
      rec(301, 21, '莫娜', 5), // ⑥ pulls=5 歪 → 开组,结尾未闭合 → 丢弃
    ]
    const stats = computePoolStats('eventChar', records)
    expect(stats.totalPulls).toBe(22)
    // 有效组:组1=4、组2=10、组3=3 → 均值 17/3
    expect(stats.avgUpPulls).toBeCloseTo(17 / 3, 12)
    expect(stats.avgPulls).toBeCloseTo(22 / 6, 12) // 全部五星 1+3+4+6+3+5=22,/6
    expect(stats.offRate).toBe(0.5) // T,F,T,F,F,T → 3/6
    expect(stats.guarantee).toBe('guaranteed') // 末个五星莫娜歪
    expect(stats.pity?.current).toBe(0)
  })
})

describe('H5 四星保底(四星与五星都清零,反「只数四星」回归)', () => {
  it('五星后未出四星:计数被五星清零后重计', () => {
    const records = [
      ...fillers(200, 0, 4),
      rec(200, 4, '四星武器', 4), // 清零
      ...fillers(200, 5, 3),
      rec(200, 8, '迪卢克', 5), // 五星也必须清零(若只数四星,此处不清)
      ...fillers(200, 9, 2),
    ]
    const stats = computePoolStats('standard', records)
    expect(stats.fourPity).toEqual({ current: 2 }) // 「只数四星」错法会得 6
    expect(stats.pity?.current).toBe(2)
  })

  it('四星清零与五星保底各自独立', () => {
    const records = [...fillers(200, 0, 9), rec(200, 9, '四星武器', 4)]
    const stats = computePoolStats('standard', records)
    expect(stats.fourPity).toEqual({ current: 0 }) // 第 10 抽出四星,清零
    expect(stats.pity?.current).toBe(10) // 五星计数不受四星影响
  })
})

describe('H6 硬/软保底带与跨期延续(spec D7)', () => {
  it('N 抽无五星 → current=N;角色类 90/74、武器 80/63', () => {
    const charStats = computePoolStats('eventChar', fillers(301, 0, 30))
    expect(charStats.pity).toEqual({ current: 30, hard: 90, softFrom: 74 })
    const weaponStats = computePoolStats('eventWeapon', fillers(302, 0, 20))
    expect(weaponStats.pity).toEqual({ current: 20, hard: 80, softFrom: 63 })
  })

  it('某五星后 M 抽 → current=M', () => {
    const records = [...fillers(301, 0, 5), rec(301, 5, '迪卢克', 5), ...fillers(301, 6, 7)]
    expect(computePoolStats('eventChar', records).pity?.current).toBe(7)
  })

  it('跨期延续:两段记录(时间不连续)之间保底不按卡池期重置', () => {
    const records = [
      ...fillers(301, 0, 10),
      rec(301, 10, '迪卢克', 5), // 上一个卡池期收尾五星
      ...fillers(301, 100, 4), // 下一期(分钟跳号模拟跨期)
    ]
    expect(computePoolStats('eventChar', records).pity?.current).toBe(4)
  })

  it('current 超 hard 属数据异常,照实显示不钳制(spec D7)', () => {
    const stats = computePoolStats('eventChar', fillers(301, 0, 95))
    expect(stats.pity).toEqual({ current: 95, hard: 90, softFrom: 74 })
  })
})

describe('H13 集录独立保底、新手无保底带、unknown 兜底', () => {
  it('集录(500):保底独立 90、无歪章,与 eventChar 记录互不干扰', () => {
    const chronicled = [
      ...fillers(500, 0, 10),
      rec(500, 10, '迪卢克', 5), // 名单名也不判歪:off 恒 null(v1 无歪章)
      ...fillers(500, 11, 2),
      rec(500, 13, '阿莫斯之弓', 5), // pulls=3,完整
      ...fillers(500, 14, 5),
    ]
    const eventChar = [rec(301, 30, '三星武器', 3), rec(301, 31, '三星武器', 3), rec(301, 32, '三星武器', 3)]
    const stats = computePoolStats('chronicled', [...chronicled, ...eventChar])
    expect(stats.codes).toEqual([500])
    expect(stats.totalPulls).toBe(19) // 301 行不混入
    expect(stats.fives.map((f) => [f.pulls, f.off])).toEqual([
      [11, null],
      [3, null],
    ])
    expect(stats.avgPulls).toBe(7)
    expect(stats.offRate).toBeNull()
    expect(stats.avgUpPulls).toBeNull()
    expect(stats.guarantee).toBeNull()
    expect(stats.pity).toEqual({ current: 5, hard: 90, softFrom: 74 }) // 独立 90,不计 301 行
    expect(stats.rosterStale).toBeUndefined()

    const charStats = computePoolStats('eventChar', [...chronicled, ...eventChar])
    expect(charStats.totalPulls).toBe(3)
    expect(charStats.fives).toHaveLength(0)
    expect(charStats.pity).toEqual({ current: 3, hard: 90, softFrom: 74 })
  })

  it('新手(100):无保底带(pity null),单池统计其余字段完整可用', () => {
    const records = [
      ...fillers(100, 0, 15),
      rec(100, 15, '迪卢克', 5),
      ...fillers(100, 16, 4), // 共 20 抽(新手池限 20)
    ]
    const stats = computePoolStats('novice', records)
    expect(stats.scope).toBe('novice')
    expect(stats.codes).toEqual([100])
    expect(stats.totalPulls).toBe(20)
    expect(stats.fives.map((f) => [f.pulls, f.off])).toEqual([[16, null]])
    expect(stats.avgPulls).toBe(16)
    expect(stats.offRate).toBeNull()
    expect(stats.avgUpPulls).toBeNull()
    expect(stats.guarantee).toBeNull()
    expect(stats.pity).toBeNull() // 裁定:spec §2 新手无保底带 → pity 置 null
    expect(stats.fourPity).toEqual({ current: 4 })
  })

  it('unknown:未知 code 兜底,无比率无保底,codes 保留原始值', () => {
    const records = [...fillers(1000, 0, 3), rec(1000, 3, '颂愿五星', 5)]
    const stats = computePoolStats('unknown', records)
    expect(stats.codes).toEqual([1000])
    expect(stats.totalPulls).toBe(4)
    expect(stats.fives[0]?.off).toBeNull()
    expect(stats.pity).toBeNull()
    expect(stats.offRate).toBeNull()
    expect(stats.guarantee).toBeNull()
    expect(stats.avgUpPulls).toBeNull()
  })
})

describe('H14 防御分支(off=null 不可达路径,空名注入钉死)', () => {
  it('off=null:断组丢弃、不入歪率分母、avgUpPulls 不含该组', () => {
    const records = [
      rec(301, 0, '三星武器', 3),
      rec(301, 1, '迪卢克', 5), // ① pulls=2 歪 → 开组
      rec(301, 2, '三星武器', 3),
      rec(301, 3, '提纳里', 5), // ② pulls=2 UP → 组1=4
      rec(301, 4, '三星武器', 3),
      rec(301, 5, '刻晴', 5), // ③ pulls=2 歪 → 开组
      rec(301, 6, '三星武器', 3),
      rec(301, 7, '', 5), // ④ pulls=2 off=null → 断组:刻晴的组被丢弃,null 不入分母
      rec(301, 8, '三星武器', 3),
      rec(301, 9, '提纳里', 5), // ⑤ pulls=2 UP,直接 UP 自成一组 → 计入
    ]
    const stats = computePoolStats('eventChar', records)
    expect(stats.fives[3]?.off).toBeNull()
    expect(stats.avgUpPulls).toBe(3) // 组1=4、直接 UP 组=2 → (4+2)/2;刻晴组因断组丢弃
    expect(stats.offRate).toBe(0.5) // 分母只含 T,F,T,F:2/4
    expect(stats.avgPulls).toBe(2) // 全部五星(含 off=null 者)pulls 均 2
    expect(stats.guarantee).toBe('fiftyFifty') // 末个五星 off=false
  })

  it('末个五星 off=null → guarantee 保守 fiftyFifty(而非 guaranteed)', () => {
    const records = [
      rec(301, 0, '迪卢克', 5), // 歪 → 本应 guaranteed
      rec(301, 1, '三星武器', 3),
      rec(301, 2, '', 5), // off=null → 保守按小保底
    ]
    const stats = computePoolStats('eventChar', records)
    expect(stats.guarantee).toBe('fiftyFifty')
    expect(stats.offRate).toBe(1) // null 不入分母,分母只剩迪卢克
  })
})

describe('off 判定接入与 rosterStale 池级旗标(T17 返工收窄口径)', () => {
  it('名单外限定五星:条目级 rosterStale 保持 ADR 字面,池级不再触发(回归)', () => {
    const records = [
      rec(301, 0, '那维莱特', 5), // 非空名全名单查无 → 条目级 stale + off=false
      rec(301, 1, '三星武器', 3),
      rec(301, 2, '迪卢克', 5), // 名单内 → 歪,无 stale
    ]
    const stats = computePoolStats('eventChar', records)
    expect(stats.fives[0]?.rosterStale).toBe(true) // 条目级:ADR-0003 §4 字面语义不变
    expect(stats.fives[0]?.off).toBe(false) // 宁可信 UP:仍计 UP 并入分母
    expect(stats.fives[1]?.rosterStale).toBeUndefined()
    // 限定 UP 名单查无属常态,不再触发池级旗标(返工裁定)
    expect(stats.rosterStale).toBeUndefined()
    expect(stats.offRate).toBe(0.5)
  })

  it('常驻池出现名单外五星 → 池级 rosterStale 置 true(名单过期可判信号)', () => {
    const records = [
      rec(301, 0, '那维莱特', 5), // 限定 UP:不触发
      ...fillers(301, 1, 5),
      rec(301, 6, '提纳里', 5),
      rec(200, 7, '虚构的新常驻角色', 5), // 新常驻成员必经常驻池:全名单查无 → 池级 true
    ]
    const stats = computePoolStats('eventChar', records)
    expect(stats.rosterStale).toBe(true)
  })

  it('池级检查只查全名单、不判生效日期;旗标仅 eventChar 携带', () => {
    // 提纳里在 2022-08(早于 3.1 入常驻)出现于常驻池属不可能历史,但全名单命中 → 不置旗标
    expect(computePoolStats('eventChar', [rec(200, 0, '提纳里', 5)]).rosterStale).toBeUndefined()
    // 池级旗标仅 eventChar 携带(歪判定与「误判为 UP」后果只在 eventChar 生效)
    const standardStats = computePoolStats('standard', [rec(200, 0, '虚构的新常驻角色', 5)])
    expect(standardStats.rosterStale).toBeUndefined()
  })
})
