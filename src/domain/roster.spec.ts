import { describe, expect, it } from 'vitest'
import type { WishRecord } from './records'
import { buildRoster, constellationOf, refinementOf, ROSTER_CONSTELLATION_NOTE } from './roster'

/**
 * 测试工厂:与 stats.spec.ts 同款——time 以「2022-08-01 + minute 分钟」生成
 * (同日字典序=时间序)。全部取 2022-08(早于 3.1 上线日 2022-09-28):
 * 「提纳里」恒判 UP(off:false),1.0 名单成员(迪卢克/刻晴)恒判歪(off:true),
 * 逐值可手工核算。
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

/** 名册内获取条数合计(验收:恒等于作用域五星总数,不丢不合) */
function totalAcquisitions(view: { cards: { acquisitions: unknown[] }[] }): number {
  return view.cards.reduce((sum, card) => sum + card.acquisitions.length, 0)
}

describe('H10 命座/精炼跨池累计序号(globalIndex 为全档案口径)', () => {
  it('同一角色跨 eventChar/standard/chronicled 四次获取 → globalIndex 1/2/3/4', () => {
    const records = [
      ...fillers(301, 0, 2),
      rec(301, 2, '迪卢克', 5), // eventChar 第 1 次(全局第 1 次)
      rec(200, 3, '迪卢克', 5), // standard(全局第 2 次)
      rec(500, 4, '迪卢克', 5), // chronicled(全局第 3 次)
      rec(400, 5, '迪卢克', 5), // eventChar 第 2 次(全局第 4 次)
    ]
    const eventChar = buildRoster('eventChar', records)
    expect(eventChar.cards).toHaveLength(1) // 301/400 同名合并一张卡片
    expect(eventChar.cards[0]?.acquisitions.map((a) => a.globalIndex)).toEqual([4, 1]) // 新的在前

    // 跨池口径:standard/chronicled 名册里看到的不是「该池第 1 次」而是全局序
    // (DESIGN §6:刻晴 边界→常驻一命→集录二命,同一换算)
    expect(buildRoster('standard', records).cards[0]?.acquisitions[0]?.globalIndex).toBe(2)
    expect(buildRoster('chronicled', records).cards[0]?.acquisitions[0]?.globalIndex).toBe(3)
  })

  it('C 封顶:8 次获取 → 第 7、8 次均 C6;换算函数边界', () => {
    const records = Array.from({ length: 8 }, (_, i) => rec(200, i, '迪卢克', 5))
    const view = buildRoster('standard', records)
    expect(view.cards[0]?.acquisitions.map((a) => a.globalIndex)).toEqual([8, 7, 6, 5, 4, 3, 2, 1])
    expect(view.cards[0]?.acquisitions.map((a) => constellationOf(a.globalIndex))).toEqual([
      6, 6, 5, 4, 3, 2, 1, 0,
    ])
    expect(constellationOf(1)).toBe(0)
    expect(constellationOf(2)).toBe(1)
    expect(constellationOf(7)).toBe(6)
    expect(constellationOf(8)).toBe(6)
    expect(constellationOf(9)).toBe(6)
  })

  it('武器 R 封顶:6 次获取 → 第 6 次 R5;换算函数边界', () => {
    const records = Array.from({ length: 6 }, (_, i) => rec(302, i, '天空之翼', 5))
    const view = buildRoster('eventWeapon', records)
    expect(view.cards[0]?.acquisitions.map((a) => refinementOf(a.globalIndex))).toEqual([
      5, 4, 3, 2, 1, 0,
    ])
    expect(refinementOf(1)).toBe(0)
    expect(refinementOf(5)).toBe(4)
    expect(refinementOf(6)).toBe(5)
    expect(refinementOf(7)).toBe(5)
  })

  it('尾注常量钉住文案口径(活动赠送命座可能导致与游戏内差 1)', () => {
    expect(ROSTER_CONSTELLATION_NOTE).toBe(
      '仅按祈愿记录累计,与游戏内实际命座可能因活动赠送差 1',
    )
  })
})

describe('分组与排序(每卡片=一个物品,获取列表新的在前)', () => {
  it('同池同名两次五星 → 一张卡片两条获取,新的在前', () => {
    const records = [
      rec(301, 0, '迪卢克', 5), // ① pulls=1,全局第 1 次
      ...fillers(301, 1, 4),
      rec(301, 5, '迪卢克', 5), // ② pulls=5,全局第 2 次
    ]
    const view = buildRoster('eventChar', records)
    expect(view.cards).toHaveLength(1)
    expect(view.cards[0]?.name).toBe('迪卢克')
    expect(view.cards[0]?.acquisitions.map((a) => [a.pulls, a.globalIndex])).toEqual([
      [5, 2],
      [1, 1],
    ])
  })

  it('卡片按各物品最新获取时间倒序;出货逐条列出,条数恒等于作用域五星总数', () => {
    const records = [
      rec(301, 0, '迪卢克', 5),
      rec(301, 1, '刻晴', 5),
      rec(301, 2, '迪卢克', 5), // 迪卢克最新一次晚于刻晴唯一一次 → 其卡片在前
    ]
    const view = buildRoster('eventChar', records)
    expect(view.cards.map((c) => c.name)).toEqual(['迪卢克', '刻晴'])
    expect(view.cards[0]?.acquisitions.map((a) => a.globalIndex)).toEqual([2, 1])
    expect(view.cards[1]?.acquisitions.map((a) => a.globalIndex)).toEqual([1])
    expect(totalAcquisitions(view)).toBe(3) // 3 条出货一条不少
  })
})

describe('pulls/off 字段', () => {
  it('作用域首个五星照常携带 pulls;非 eventChar 作用域 off 恒 null', () => {
    const records = [
      ...fillers(200, 0, 10),
      rec(200, 10, '迪卢克', 5), // ① pulls=11,off=null(standard 不判歪)
      ...fillers(200, 11, 4),
      rec(200, 15, '刻晴', 5), // ② pulls=5
    ]
    const view = buildRoster('standard', records)
    expect(view.cards.map((c) => c.name)).toEqual(['刻晴', '迪卢克'])
    expect(view.cards[0]?.acquisitions[0]).toEqual({
      pulls: 5,
      off: null,
      date: '2022-08-01',
      pool: '常驻祈愿',
      globalIndex: 1,
    })
    expect(view.cards[1]?.acquisitions[0]).toEqual({
      pulls: 11,
      off: null,
      date: '2022-08-01',
      pool: '常驻祈愿',
      globalIndex: 1,
    })
  })

  it('eventChar 作用域 acquisition 带歪判定(歪/不歪章的数据源)', () => {
    const records = [
      ...fillers(301, 0, 2),
      rec(301, 2, '迪卢克', 5), // 1.0 名单成员 → 歪
      ...fillers(301, 3, 3),
      rec(301, 6, '提纳里', 5), // 3.1 前限定 → UP
    ]
    const view = buildRoster('eventChar', records)
    expect(view.cards.map((c) => c.name)).toEqual(['提纳里', '迪卢克'])
    expect(view.cards[0]?.acquisitions[0]?.off).toBe(false)
    expect(view.cards[1]?.acquisitions[0]?.off).toBe(true)
  })
})

describe('汇总芯片(UP n · 歪 n · 超欧 n · 超非 n)', () => {
  it('eventChar:up/off 数 off 非 null 的五星;超欧/超非按 degreeOf', () => {
    const records = [
      rec(301, 0, '迪卢克', 5), // ① pulls=1 歪
      ...fillers(301, 1, 29),
      rec(301, 30, '提纳里', 5), // ② pulls=30 UP,degree=lucky(23–45)
      ...fillers(301, 31, 43),
      rec(301, 74, '刻晴', 5), // ③ pulls=44 歪,degree=lucky
      ...fillers(301, 75, 15),
      rec(301, 90, '提纳里', 5), // ④ pulls=16 UP,degree=superLucky(≤22)
    ]
    const view = buildRoster('eventChar', records)
    expect(view.summary).toEqual({ up: 2, off: 2, superLucky: 2, unlucky: 0 })
    expect(view.cards.map((c) => c.name)).toEqual(['提纳里', '刻晴', '迪卢克'])
    expect(view.cards[0]?.acquisitions.map((a) => a.globalIndex)).toEqual([2, 1]) // 同物两次同卡
    expect(totalAcquisitions(view)).toBe(4)
  })

  it('非 eventChar 作用域:up/off 置 null(UI 隐藏芯片),超欧/超非照算', () => {
    const records = [
      rec(200, 0, '刻晴', 5), // ① pulls=1 → 超欧(首金照常分档)
      ...fillers(200, 1, 85),
      rec(200, 86, '迪卢克', 5), // ② pulls=86 → 超非(≥77)
    ]
    const view = buildRoster('standard', records)
    expect(view.summary).toEqual({ up: null, off: null, superLucky: 1, unlucky: 1 })
  })
})

describe('pool 名与日期', () => {
  it('301/400 显示具体 code 名;date 为 time 串前 10 字符', () => {
    const records = [rec(301, 0, '迪卢克', 5), rec(400, 1, '刻晴', 5)]
    const view = buildRoster('eventChar', records)
    expect(view.cards.map((c) => c.name)).toEqual(['刻晴', '迪卢克'])
    expect(view.cards[0]?.acquisitions[0]?.pool).toBe('角色活动祈愿-2')
    expect(view.cards[1]?.acquisitions[0]?.pool).toBe('角色活动祈愿')
    expect(view.cards[0]?.acquisitions[0]?.date).toBe('2022-08-01')
  })
})
