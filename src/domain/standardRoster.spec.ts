import { describe, expect, it } from 'vitest'
import {
  STANDARD_ROSTER,
  VERSION_RELEASE_DATES,
  isStandardAt,
  standardVerdict,
} from './standardRoster'

describe('常驻名单快照(ADR-0003 §5 反例测试)', () => {
  it('名单共 18 条:角色 8 + 武器 10', () => {
    expect(STANDARD_ROSTER).toHaveLength(18)
    expect(STANDARD_ROSTER.filter((e) => e.kind === 'character')).toHaveLength(8)
    expect(STANDARD_ROSTER.filter((e) => e.kind === 'weapon')).toHaveLength(10)
  })

  it('名单全量快照(增补须显式更新本测试并随条目补版本日期)', () => {
    expect(STANDARD_ROSTER.map((e) => [e.name, e.kind, e.since])).toEqual([
      ['迪卢克', 'character', '1.0'],
      ['琴', 'character', '1.0'],
      ['莫娜', 'character', '1.0'],
      ['七七', 'character', '1.0'],
      ['刻晴', 'character', '1.0'],
      ['提纳里', 'character', '3.1'],
      ['迪希雅', 'character', '3.6'],
      ['梦见月瑞希', 'character', '5.5'],
      ['天空之刃', 'weapon', '1.0'],
      ['天空之傲', 'weapon', '1.0'],
      ['天空之脊', 'weapon', '1.0'],
      ['天空之卷', 'weapon', '1.0'],
      ['天空之翼', 'weapon', '1.0'],
      ['风鹰剑', 'weapon', '1.0'],
      ['狼的末路', 'weapon', '1.0'],
      ['和璞鸢', 'weapon', '1.0'],
      ['四风原典', 'weapon', '1.0'],
      ['阿莫斯之弓', 'weapon', '1.0'],
    ])
  })

  it('限定物品不得混入:黎明破晓之史(6.2 限定五星弓,社区 fork 误入案例)与当期限定角色那维莱特', () => {
    const names = STANDARD_ROSTER.map((e) => e.name)
    expect(names).not.toContain('黎明破晓之史')
    expect(names).not.toContain('那维莱特')
  })

  it('名单名称无重复(isStandardAt 按名称 find 的前提)', () => {
    const names = STANDARD_ROSTER.map((e) => e.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('版本上线日期表快照(UTC+8 开启日,4 键)', () => {
    expect(VERSION_RELEASE_DATES).toEqual({
      '1.0': '2020-09-28',
      '3.1': '2022-09-28',
      '3.6': '2023-04-12',
      '5.5': '2025-03-12',
    })
  })

  it('版本日期表键与名单 since 集合一致(无悬空版本)', () => {
    const sinceSet = new Set(STANDARD_ROSTER.map((e) => e.since))
    const keys = Object.keys(VERSION_RELEASE_DATES)
    expect(keys).toHaveLength(sinceSet.size)
    for (const since of sinceSet) expect(keys).toContain(since)
    for (const key of keys) expect(sinceSet.has(key)).toBe(true)
  })
})

describe('standardVerdict 歪判定边界(spec 04 H2 名单部分)', () => {
  it('提纳里:3.1 上线日(2022-09-28)前出 = UP,上线起 = 歪', () => {
    expect(standardVerdict({ name: '提纳里', time: '2022-09-27 23:59:59', rankType: 5 })).toEqual({
      off: false,
      rosterStale: false,
    })
    expect(standardVerdict({ name: '提纳里', time: '2022-09-28 00:00:00', rankType: 5 })).toEqual({
      off: true,
      rosterStale: false,
    })
  })

  it('梦见月瑞希:5.5 上线日(2025-03-12)前后分界', () => {
    expect(standardVerdict({ name: '梦见月瑞希', time: '2025-03-11 23:59:59', rankType: 5 })).toEqual({
      off: false,
      rosterStale: false,
    })
    expect(standardVerdict({ name: '梦见月瑞希', time: '2025-03-12 00:00:00', rankType: 5 })).toEqual({
      off: true,
      rosterStale: false,
    })
  })

  it('迪卢克任意历史时刻均判歪(1.0 开服常驻,正常历史不置 stale)', () => {
    expect(standardVerdict({ name: '迪卢克', time: '2021-03-15 12:00:00', rankType: 5 })).toEqual({
      off: true,
      rosterStale: false,
    })
  })

  it('黎明破晓之史不在名单 → 按 UP 处理并置 rosterStale 告警(ADR-0003 §4 唯一失效模式)', () => {
    expect(standardVerdict({ name: '黎明破晓之史', time: '2026-01-10 10:00:00', rankType: 5 })).toEqual({
      off: false,
      rosterStale: true,
    })
  })

  it('名称空串 → off null 不武断判 UP,不置 stale(『unknown』语义,H14 防御分支兜底)', () => {
    expect(standardVerdict({ name: '', time: '2026-01-10 10:00:00', rankType: 5 })).toEqual({
      off: null,
      rosterStale: false,
    })
  })
})

describe('isStandardAt 底层判定', () => {
  it('全名单查无此名返回 null,由调用方按 UP + stale 处理', () => {
    expect(isStandardAt('那维莱特', '2026-01-10 10:00:00')).toBeNull()
  })

  it('1.0 武器自开服起全程生效', () => {
    expect(isStandardAt('阿莫斯之弓', '2020-10-20 08:00:00')).toBe(true)
  })
})
