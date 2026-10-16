import { describe, expect, it } from 'vitest'
import type { WishRecord } from './records'
import { computePoolStats, type PoolStats } from './stats'
import {
  applyVerdict,
  CAPTURE_RADIANCE_FOOTNOTE,
  degreeOf,
  EASTER_EGG_MAX_PULLS,
  EVENT_CHAR_EXPECTED,
  EVENT_WEAPON_EXPECTED,
  RATING_COMMENTS,
  ratingOf,
  type Degree,
} from './verdict'

/**
 * 测试工厂:time 以「2022-08-01 + minute 分钟」生成(同日字典序=时间序,分钟序号即时间序)。
 * 与 stats.spec.ts 同款:全部取 2022-08(早于 3.1 上线日),名单成员(迪卢克/刻晴/莫娜/
 * 提纳里)恒可判定,便于逐值手工核算。
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

/**
 * 手工构造最小 PoolStats:仅用于 computePoolStats 无法以小分母产出的 offRate 微边界
 * (如 0.599);其余用例一律走 computePoolStats 真实产物(spec:applyVerdict 的输入)。
 */
function manualStats(overrides: Partial<PoolStats> & Pick<PoolStats, 'scope'>): PoolStats {
  return {
    codes: [],
    totalPulls: 0,
    fives: [],
    avgPulls: null,
    avgUpPulls: null,
    offRate: null,
    pity: null,
    fourPity: { current: 0 },
    guarantee: null,
    ...overrides,
  }
}

describe('H7 程度四档全边界(spec D9)', () => {
  const charCases: ReadonlyArray<[number, Degree]> = [
    [22, 'superLucky'],
    [23, 'lucky'],
    [45, 'lucky'],
    [46, 'normal'],
    [76, 'normal'],
    [77, 'unlucky'],
  ]
  const weaponCases: ReadonlyArray<[number, Degree]> = [
    [19, 'superLucky'],
    [20, 'lucky'],
    [40, 'lucky'],
    [41, 'normal'],
    [68, 'normal'],
    [69, 'unlucky'],
  ]

  it('角色类池档表(90 保底):22/23、45/46、76/77 逐格一致', () => {
    for (const [pulls, degree] of charCases) expect(degreeOf(pulls, 'eventChar')).toBe(degree)
  })

  it('武器池档表(80 保底):19/20、40/41、68/69 逐格一致', () => {
    for (const [pulls, degree] of weaponCases) expect(degreeOf(pulls, 'eventWeapon')).toBe(degree)
  })

  it('角色类档同样适用于 standard/chronicled/novice/unknown(与 hardPity 90 兜底一致)', () => {
    for (const scope of ['standard', 'chronicled', 'novice', 'unknown'] as const) {
      for (const [pulls, degree] of charCases) expect(degreeOf(pulls, scope)).toBe(degree)
    }
  })

  it('武器档不外溢到其他作用域:69 抽在 unknown 仍按角色档判「正常」', () => {
    expect(degreeOf(19, 'unknown')).toBe('superLucky')
    expect(degreeOf(69, 'unknown')).toBe('normal')
  })
})

describe('H7 评级五档全边界(spec D10)', () => {
  it('角色活动:45/46、62/63、72/73、77/78 逐格一致', () => {
    expect(ratingOf(45, 'eventChar')).toBe('S')
    expect(ratingOf(46, 'eventChar')).toBe('A')
    expect(ratingOf(62, 'eventChar')).toBe('A')
    expect(ratingOf(63, 'eventChar')).toBe('B')
    expect(ratingOf(72, 'eventChar')).toBe('B')
    expect(ratingOf(73, 'eventChar')).toBe('C')
    expect(ratingOf(77, 'eventChar')).toBe('C')
    expect(ratingOf(78, 'eventChar')).toBe('D')
  })

  it('武器活动:40/41、53/54、62/63、71/72 逐格一致', () => {
    expect(ratingOf(40, 'eventWeapon')).toBe('S')
    expect(ratingOf(41, 'eventWeapon')).toBe('A')
    expect(ratingOf(53, 'eventWeapon')).toBe('A')
    expect(ratingOf(54, 'eventWeapon')).toBe('B')
    expect(ratingOf(62, 'eventWeapon')).toBe('B')
    expect(ratingOf(63, 'eventWeapon')).toBe('C')
    expect(ratingOf(71, 'eventWeapon')).toBe('C')
    expect(ratingOf(72, 'eventWeapon')).toBe('D')
  })

  it('仅 eventChar/eventWeapon 评级,其余作用域恒 null(「—」由 UI 渲染)', () => {
    for (const scope of ['standard', 'chronicled', 'novice', 'unknown'] as const) {
      expect(ratingOf(10, scope)).toBeNull()
    }
  })

  it('期望参考线常量:角色类 62.5(官方 1.6% 倒数)/武器 53.25(社区口径);novice 不评级但共享常量', () => {
    expect(EVENT_CHAR_EXPECTED).toBe(62.5)
    expect(EVENT_WEAPON_EXPECTED).toBe(53.25)
    expect(ratingOf(EVENT_CHAR_EXPECTED, 'novice')).toBeNull()
  })
})

describe('H8 歪率修正(spec D11:offRate ≥ 60% 降半档)', () => {
  /** 五星序列 歪/UP/歪/UP/歪、完整档各 30 抽 → 原始 S 且 offRate = 3/5 = 0.60(整) */
  function correctionCase(): WishRecord[] {
    return [
      rec(301, 0, '迪卢克', 5), // 五星① pulls=1,incomplete,歪(计入歪率分母,不计均值)
      ...fillers(301, 1, 29),
      rec(301, 30, '提纳里', 5), // 五星② pulls=30,完整,UP
      ...fillers(301, 31, 29),
      rec(301, 60, '刻晴', 5), // 五星③ pulls=30,完整,歪
      ...fillers(301, 61, 29),
      rec(301, 90, '提纳里', 5), // 五星④ pulls=30,完整,UP
      ...fillers(301, 91, 29),
      rec(301, 120, '莫娜', 5), // 五星⑤ pulls=30,完整,歪
    ]
  }

  it('offRate 恰 0.60 触发 S→A+:显示评级加 +、评语改降后档、修正说明含实际百分比', () => {
    const stats = computePoolStats('eventChar', correctionCase())
    expect(stats.avgPulls).toBe(30)
    expect(stats.offRate).toBeCloseTo(0.6, 12)
    const view = applyVerdict(stats)
    expect(view.rating).toBe('S')
    expect(view.displayRating).toBe('A+')
    expect(view.comment).toBe(RATING_COMMENTS.A)
    expect(view.correction).toBe('歪率 60%,评级降半档')
    expect(view.rosterStale).toBe(false)
  })

  /** 五连歪、完整档各 80 抽 → 原始 D 且 offRate = 1(远超触发线) */
  function dCase(): WishRecord[] {
    const names = ['刻晴', '莫娜', '琴', '七七']
    const records = [rec(301, 0, '迪卢克', 5)]
    let minute = 0
    for (let i = 0; i < 4; i += 1) {
      records.push(...fillers(301, minute + 1, 79))
      minute += 80
      records.push(rec(301, minute, names[i], 5)) // pulls=80
    }
    return records
  }

  it('D 档不再降:「D+」不存在,评语维持 D 档,不追加修正说明', () => {
    const stats = computePoolStats('eventChar', dCase())
    expect(stats.avgPulls).toBe(80)
    expect(stats.offRate).toBe(1)
    const view = applyVerdict(stats)
    expect(view.rating).toBe('D')
    expect(view.displayRating).toBe('D')
    expect(view.correction).toBeNull()
    expect(view.comment).toBe(RATING_COMMENTS.D)
  })

  it('offRate 0.599(< 60%)不修正:显示评级不变、无修正说明', () => {
    const view = applyVerdict(manualStats({ scope: 'eventChar', avgPulls: 30, offRate: 0.599 }))
    expect(view.rating).toBe('S')
    expect(view.displayRating).toBe('S')
    expect(view.correction).toBeNull()
    expect(view.comment).toBe(RATING_COMMENTS.S)
  })

  it('非 eventChar 恒不修正(eventWeapon 即便手填歪率也不加 +)', () => {
    const view = applyVerdict(manualStats({ scope: 'eventWeapon', avgPulls: 30, offRate: 0.9 }))
    expect(view.rating).toBe('S')
    expect(view.displayRating).toBe('S')
    expect(view.correction).toBeNull()
  })
})

describe('H9 低抽数彩蛋(spec D11:最快完整五星 ≤ 10 抽)', () => {
  it(`pulls=${EASTER_EGG_MAX_PULLS} 触发,徽章含名/抽数/日期`, () => {
    const records = [
      rec(200, 0, '天空之刃', 5), // 作用域首个五星恒 incomplete(pulls=1 占位,不参与)
      ...fillers(200, 1, 9),
      rec(200, 10, '风鹰剑', 5), // pulls=10,完整 → 触发
      ...fillers(200, 11, 30),
      rec(200, 41, '四星武器', 4),
    ]
    const view = applyVerdict(computePoolStats('standard', records))
    expect(view.easterEgg).toEqual({ name: '风鹰剑', pulls: 10, date: '2022-08-01' })
  })

  it('pulls=11 不触发', () => {
    const records = [
      rec(200, 0, '天空之刃', 5),
      ...fillers(200, 1, 10),
      rec(200, 11, '风鹰剑', 5), // pulls=11
    ]
    expect(applyVerdict(computePoolStats('standard', records)).easterEgg).toBeNull()
  })

  it('不完整五星不触发(pulls=1 是占位下界,不可信)', () => {
    const records = [
      rec(200, 0, '天空之刃', 5), // incomplete pulls=1(误信即触发)
      ...fillers(200, 1, 10),
      rec(200, 11, '风鹰剑', 5), // 完整 pulls=11,不达阈值
    ]
    expect(applyVerdict(computePoolStats('standard', records)).easterEgg).toBeNull()
  })

  it('并列最快取更晚的一次', () => {
    const records = [
      rec(200, 0, '天空之刃', 5),
      ...fillers(200, 1, 9),
      rec(200, 10, '风鹰剑', 5), // pulls=10(早)
      ...fillers(200, 11, 9),
      rec(200, 20, '阿莫斯之弓', 5), // pulls=10(晚,并列)
    ]
    expect(applyVerdict(computePoolStats('standard', records)).easterEgg).toEqual({
      name: '阿莫斯之弓',
      pulls: 10,
      date: '2022-08-01',
    })
  })
})

describe('applyVerdict 视图组装(spec D11/D12 其余字段)', () => {
  it('不评级作用域:评级/评语/修正全落 null,彩蛋与脚注常量照常输出', () => {
    const records = [
      rec(200, 0, '天空之刃', 5),
      ...fillers(200, 1, 4),
      rec(200, 5, '风鹰剑', 5), // pulls=5,完整 → 触发彩蛋
    ]
    const view = applyVerdict(computePoolStats('standard', records))
    expect(view.scope).toBe('standard')
    expect(view.rating).toBeNull()
    expect(view.displayRating).toBeNull()
    expect(view.comment).toBeNull()
    expect(view.correction).toBeNull()
    expect(view.easterEgg).toEqual({ name: '风鹰剑', pulls: 5, date: '2022-08-01' })
    expect(view.guaranteed).toBe(false)
    expect(view.footnote).toBe(CAPTURE_RADIANCE_FOOTNOTE)
  })

  it('无完整五星(avgPulls null):不评级,歪率再高也无修正对象;大保底就绪照常亮', () => {
    const view = applyVerdict(computePoolStats('eventChar', [rec(301, 0, '迪卢克', 5)]))
    expect(view.avgPulls).toBeNull()
    expect(view.rating).toBeNull()
    expect(view.displayRating).toBeNull()
    expect(view.comment).toBeNull()
    expect(view.correction).toBeNull()
    expect(view.guaranteed).toBe(true) // 末个五星歪 → guarantee guaranteed
  })

  it('大保底未就绪(末个五星 UP):状态徽章不亮', () => {
    const records = [
      rec(301, 0, '迪卢克', 5), // 歪
      ...fillers(301, 1, 5),
      rec(301, 6, '提纳里', 5), // UP
    ]
    expect(applyVerdict(computePoolStats('eventChar', records)).guaranteed).toBe(false)
  })

  it('名单可能过期:池级 rosterStale(常驻池名单外五星)透传为提示旗标', () => {
    const records = [
      rec(301, 0, '迪卢克', 5),
      ...fillers(301, 1, 5),
      rec(301, 6, '提纳里', 5), // UP,末个五星 → 未就绪
      // T17 返工口径:常驻池五星全名单查无 → 池级旗标(经 applyVerdict 透传)
      rec(200, 7, '虚构的新常驻角色', 5),
    ]
    const view = applyVerdict(computePoolStats('eventChar', records))
    expect(view.rosterStale).toBe(true)
    expect(view.guaranteed).toBe(false)
  })

  it('评语文案库五档齐备,沿用 DESIGN §5 定稿方向起句', () => {
    expect(Object.keys(RATING_COMMENTS).sort()).toEqual(['A', 'B', 'C', 'D', 'S'])
    expect(RATING_COMMENTS.S).toContain('众星俯首')
    expect(RATING_COMMENTS.A).toContain('星辰大致守约')
    expect(RATING_COMMENTS.B).toContain('不疾不徐')
    expect(RATING_COMMENTS.C).toContain('保底的尽头')
    expect(RATING_COMMENTS.D).toContain('非到深处自然神')
  })
})
