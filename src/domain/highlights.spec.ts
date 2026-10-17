import { describe, expect, it } from 'vitest'
import { buildHighlights, buildStatusBar, buildUnknownView, guaranteedReadyText } from './highlights'
import type { WishRecord } from './records'
import { computePoolStats } from './stats'

/**
 * 小型 fixture 工厂:time = 2022-08-01 00:00 + minute 分钟(同日字典序 = 时间序)。
 * 全部取 2022-08(早于 3.1 上线日 2022-09-28):「提纳里」恒判 UP(off:false 无 stale),
 * 1.0 名单成员(迪卢克/莫娜/刻晴)恒判歪(off:true),便于逐值手工核算。
 */
function row(gachaType: number, time: string, name: string, rankType: number): WishRecord {
  return { gachaType, time, name, rankType, id: null }
}

function rec(gachaType: number, minute: number, name: string, rankType: number): WishRecord {
  const hh = String(Math.floor(minute / 60)).padStart(2, '0')
  const mm = String(minute % 60).padStart(2, '0')
  return row(gachaType, `2022-08-01 ${hh}:${mm}:00`, name, rankType)
}

/** n 条三星垫刀(分钟自 from 起连号) */
function fillers(gachaType: number, from: number, n: number): WishRecord[] {
  return Array.from({ length: n }, (_, i) => rec(gachaType, from + i, '三星武器', 3))
}

/**
 * 演示口径合成 fixture(spec 04 §6 数值基准 = DESIGN §6 场景按本 spec 口径修正,
 * 程序化构造、全程可手工核算;同时是 H12 全局排除用例的数据源)。
 *
 * 时间:30 分钟一抽,自 2022-01-01 起全局递增(全部早于 3.1 上线日——「提纳里」
 * 恒判 UP、「刻晴」等 1.0 名单成员恒判歪,判定无 stale 噪音);分池顺序生成。
 *
 * 目标数值(钉死):
 * - eventChar 合并 301/400:总 2118 抽 / 五星 19;歪率 5/19 ≈ 26.3%(首个边界五星
 *   「刻晴」判歪并计入分母,D6);平均出货 885/19 ≈ 46.6(全部五星,2026-10-18 裁决);
 * - 武器 302:528 抽 / 7 金;常驻 200:994 抽 / 7 金;集录 500:176 抽 / 1 金;
 * - 全局四作用域合计 3816 抽 / 34 金(DESIGN §6「全局 3816/34」按同构规则另建);
 * - novice 100:20 抽(限抽上限)/ 1 金;unknown 1000:3 抽 / 1 金(不入全局)。
 *
 * 布点说明:各池五星 pulls 覆盖不了全部抽数,余量落在各池末尾垫刀区(eventChar
 * 1233 抽),属合成数据的「有洞」形态——pity.current 照实显示不钳制(spec D7),
 * 不在断言范围。
 */
interface DemoFixture {
  records: WishRecord[]
  /** 全局最快五星(提纳里 5 抽,落在 400 上) */
  fastest: WishRecord
  /** 全局(四作用域)数据集的首/末 time(覆盖天数核对用) */
  firstTime: string
  lastGlobalTime: string
}

function demoFixture(): DemoFixture {
  const records: WishRecord[] = []
  let minute = 0
  const nextTime = (): string => {
    const d = new Date(Date.UTC(2022, 0, 1) + minute * 30 * 60_000)
    minute += 1
    const pad = (n: number): string => String(n).padStart(2, '0')
    return (
      `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
      `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`
    )
  }
  const push = (gachaType: number, name: string, rankType: number): WishRecord => {
    const record = row(gachaType, nextTime(), name, rankType)
    records.push(record)
    return record
  }
  const fill = (gachaType: number, n: number): void => {
    for (let i = 0; i < n; i += 1) push(gachaType, '三星武器', 3)
  }

  // —— eventChar:2118 抽 / 19 金;五星 code 按 301/400 交替(合并明细保留)——
  let fiveIndex = 0
  const fiveCode = (): number => (fiveIndex++ % 2 === 0 ? 301 : 400)
  fill(301, 44)
  push(fiveCode(), '刻晴', 5) // 五星①:45 抽,判歪(边界五星,照常参与全部统计)
  // 后续 18 金 pulls 序列:40×13 + 45 + 90×3 + 5 = 840;歪 4(莫娜/琴/七七触底 + 迪卢克)、UP 14
  const completePlan: ReadonlyArray<{ pulls: number; name: string }> = [
    { pulls: 40, name: '提纳里' }, // UP
    { pulls: 40, name: '提纳里' }, // UP
    { pulls: 90, name: '莫娜' }, // 歪,触底
    { pulls: 40, name: '提纳里' }, // UP
    { pulls: 45, name: '提纳里' }, // UP
    { pulls: 90, name: '琴' }, // 歪,触底
    { pulls: 5, name: '提纳里' }, // UP,全局最快(出手如电;第 8 枚 → code 400)
    { pulls: 40, name: '提纳里' }, // UP
    { pulls: 40, name: '提纳里' }, // UP
    { pulls: 90, name: '七七' }, // 歪,触底
    { pulls: 40, name: '提纳里' }, // UP
    { pulls: 40, name: '提纳里' }, // UP
    { pulls: 40, name: '迪卢克' }, // 歪
    { pulls: 40, name: '提纳里' }, // UP
    { pulls: 40, name: '提纳里' }, // UP
    { pulls: 40, name: '提纳里' }, // UP
    { pulls: 40, name: '提纳里' }, // UP
    { pulls: 40, name: '提纳里' }, // UP(末金 UP → 小保底,不出大保底就绪牌)
  ]
  let fastest: WishRecord | null = null
  for (const plan of completePlan) {
    fill(301, plan.pulls - 1)
    const record = push(fiveCode(), plan.name, 5)
    if (plan.pulls === 5) fastest = record
  }
  fill(301, 1233) // 末尾垫刀:总数补到 44 + 1 + 840 + 1233 = 2118
  const firstTime = records[0]?.time ?? ''

  // —— 武器 302:528 抽 / 7 金(80/81 触底 ×2)——
  fill(302, 29)
  push(302, '四风原典', 5) // 30 抽
  for (const pulls of [55, 62, 80, 47, 81, 70]) {
    fill(302, pulls - 1)
    push(302, '五星武器', 5)
  }
  fill(302, 103) // 29 + 1 + 395 + 103 = 528

  // —— 常驻 200:994 抽 / 7 金(91 触底 ×1)——
  fill(200, 59)
  push(200, '常驻五星', 5) // 60 抽
  for (const pulls of [75, 45, 88, 52, 91, 23]) {
    fill(200, pulls - 1)
    push(200, '常驻五星', 5)
  }
  fill(200, 560) // 59 + 1 + 374 + 560 = 994

  // —— 集录 500:176 抽 / 1 金 ——
  fill(500, 75)
  push(500, '集录五星', 5) // 76 抽
  fill(500, 100) // 75 + 1 + 100 = 176
  const lastGlobalTime = records[records.length - 1]?.time ?? '' // 全局数据集到此为止

  // —— novice 100:20 抽(限抽上限)/ 1 金;unknown 1000:3 抽 / 1 金(不入全局)——
  fill(100, 19)
  push(100, '迪卢克', 5)
  fill(1000, 2)
  push(1000, '颂愿五星', 5)

  if (fastest === null) throw new Error('fixture 构造失败:未捕获最快五星')
  return { records, fastest, firstTime, lastGlobalTime }
}

describe('演示口径数值基准(spec 04 §6:computePoolStats 产出 DESIGN §6 修正口径)', () => {
  const fx = demoFixture()

  it('合并角色池:总 2118 / 五星 19 / 歪率 5/19 / 平均出货 885/19 ≈ 46.6', () => {
    const stats = computePoolStats('eventChar', fx.records)
    expect(stats.totalPulls).toBe(2118)
    expect(stats.codes).toEqual([301, 400])
    expect(stats.fives).toHaveLength(19)
    expect(stats.fives.map((five) => five.record.name)).toEqual([
      '刻晴', // ① 45 抽,判歪(计入歪率分母与均值,2026-10-18 裁决)
      '提纳里', '提纳里', '莫娜', '提纳里', '提纳里', '琴', '提纳里', '提纳里', '提纳里',
      '七七', '提纳里', '提纳里', '迪卢克', '提纳里', '提纳里', '提纳里', '提纳里', '提纳里',
    ])
    expect(stats.fives[0]).toMatchObject({ pulls: 45, off: true })
    expect(stats.offRate).toBeCloseTo(5 / 19, 12) // ≈ 0.2632
    expect(stats.avgPulls).toBeCloseTo(885 / 19, 12) // ≈ 46.6,全部 19 金(45 + 840)
    expect(stats.guarantee).toBe('fiftyFifty') // 末金 UP(提纳里)
  })

  it('全局旅途总览:3816 抽 / 34 金 / 覆盖天数 / 起始年月', () => {
    const view = buildHighlights(fx.records)
    expect(view.journey.totalPulls).toBe(3816) // 2118 + 528 + 994 + 176
    expect(view.journey.fiveStars).toBe(34) // 19 + 7 + 7 + 1
    // 末枚全局记录在第 3816 抽 → 2022-01-01 + 3815×30 分钟 = 2022-03-21;79 天差 + 1
    expect(fx.firstTime).toBe('2022-01-01 00:00:00')
    expect(fx.lastGlobalTime).toBe('2022-03-21 11:30:00')
    expect(view.journey.days).toBe(80)
    expect(view.journey.since).toBe('2022-01')
  })

  it('出手如电:提纳里 5 抽(400 池,UP);漫长等待 6 次;末金 UP 不出大保底牌', () => {
    const view = buildHighlights(fx.records)
    expect(view.fastest).toEqual({
      name: '提纳里',
      pulls: 5,
      date: fx.fastest.time.slice(0, 10),
      pool: '角色活动祈愿-2', // 301/400 合并作用域内保留具体 code 名
      outcome: 'UP',
    })
    // 角色 90 触底 ×3 + 武器 80/81 触底 ×2 + 常驻 91 触底 ×1;各池首金均未触底
    expect(view.touchBottoms).toBe(6)
    expect(view.guaranteed).toBeNull()
  })

  it('H12 同一 fixture 两口径:全局汇总排除 novice/unknown,状态栏记录数含之', () => {
    const view = buildHighlights(fx.records)
    const status = buildStatusBar(fx.records)
    expect(view.journey.totalPulls).toBe(3816) // 全局口径(四作用域)
    expect(view.journey.fiveStars).toBe(34)
    expect(status.recordCount).toBe(3839) // 3816 + novice 20 + unknown 3
    expect(status.since).toBe('2022-01')
  })

  it('unknown 作用域视图:原始 code 展示、仅计数', () => {
    const view = buildUnknownView(fx.records)
    expect(view.totalPulls).toBe(3)
    expect(view.fiveStars).toBe(1)
    expect(view.records[2]).toEqual({
      name: '颂愿五星',
      rankType: 5,
      time: fx.records[fx.records.length - 1]?.time,
      pool: '未收录祈愿 1000',
    })
  })
})

describe('H11 漫长等待:触底硬保底次数(90/80 按池)', () => {
  it('角色池:pulls=90 触底、89 不触底;作用域首金同样参与触底计数', () => {
    const touched = [
      rec(301, 0, '迪卢克', 5), // ① pulls=1
      ...fillers(301, 1, 89),
      rec(301, 90, '提纳里', 5), // ② pulls=90 → 触底
    ]
    expect(buildHighlights(touched).touchBottoms).toBe(1)

    const under = [
      rec(301, 0, '迪卢克', 5),
      ...fillers(301, 1, 88),
      rec(301, 89, '提纳里', 5), // pulls=89 < 90
    ]
    expect(buildHighlights(under).touchBottoms).toBe(0)

    // 作用域唯一金即 90 抽:按档案数据如实计入触底(2026-10-18 裁决)
    const singleTouch = [...fillers(301, 0, 89), rec(301, 89, '迪卢克', 5)]
    expect(buildHighlights(singleTouch).touchBottoms).toBe(1)
  })

  it('武器池:硬保底 80,pulls=80 触底、79 不触底', () => {
    const touched = [
      rec(302, 0, '四风原典', 5), // pulls=1(首金,同时成为全局最快)
      ...fillers(302, 1, 79),
      rec(302, 80, '护摩之杖', 5), // pulls=80 → 触底
    ]
    const view = buildHighlights(touched)
    expect(view.touchBottoms).toBe(1)
    expect(view.fastest).toMatchObject({ name: '四风原典', pulls: 1, pool: '武器活动祈愿', outcome: null })
  })
})

describe('H11 出手如电:并列取更晚(比较器序更靠后)', () => {
  it('跨池并列 8 抽:时间更晚的常驻五星胜出,off=null → outcome null', () => {
    const records = [
      ...fillers(301, 0, 7),
      rec(301, 7, '提纳里', 5), // 角色 ① pulls=8 UP(早)
      ...fillers(200, 8, 7),
      rec(200, 15, '刻晴', 5), // 常驻 ① pulls=8(晚)→ 胜出
    ]
    expect(buildHighlights(records).fastest).toEqual({
      name: '刻晴',
      pulls: 8,
      date: '2022-08-01',
      pool: '常驻祈愿',
      outcome: null,
    })
  })

  it('同池并列 8 抽:更晚的一枚胜出,结局「歪」', () => {
    const records = [
      ...fillers(301, 0, 7),
      rec(301, 7, '提纳里', 5), // ① pulls=8 UP(早)
      ...fillers(301, 8, 7),
      rec(301, 15, '迪卢克', 5), // ② pulls=8 歪(晚)→ 胜出
    ]
    expect(buildHighlights(records).fastest).toMatchObject({
      name: '迪卢克',
      pulls: 8,
      pool: '角色活动祈愿',
      outcome: '歪',
    })
  })
})

describe('H11 大保底就绪牌字段(池名/垫抽数/剩余)', () => {
  it('guarantee=guaranteed 时出牌:pool=角色活动祈愿、current、hard − current', () => {
    const records = [
      rec(301, 0, '迪卢克', 5), // ① pulls=1,歪(开组未闭,不影响 guarantee)
      ...fillers(301, 1, 2),
      rec(301, 3, '提纳里', 5), // ② pulls=3 UP
      ...fillers(301, 4, 25),
      rec(301, 29, '莫娜', 5), // ③ pulls=26 歪 → 末金歪,大保底就绪
      ...fillers(301, 30, 25), // 垫 25 抽
    ]
    const view = buildHighlights(records)
    expect(view.guaranteed).toEqual({ pool: '角色活动祈愿', current: 25, remaining: 65 })
    expect(guaranteedReadyText(65)).toBe('65 抽内必中 UP')
  })

  it('末金歪后零垫刀:current=0、remaining=90,照实出牌', () => {
    const records = [
      rec(301, 0, '迪卢克', 5),
      ...fillers(301, 1, 7),
      rec(301, 8, '提纳里', 5), // UP
      ...fillers(301, 9, 7),
      rec(301, 16, '迪卢克', 5), // 歪,末金 → guaranteed,垫 0 抽
    ]
    expect(buildHighlights(records).guaranteed).toEqual({
      pool: '角色活动祈愿',
      current: 0,
      remaining: 90,
    })
  })

  it('小保底(末金 UP)不出牌 → null', () => {
    const records = [rec(301, 0, '迪卢克', 5), rec(301, 1, '提纳里', 5)]
    expect(buildHighlights(records).guaranteed).toBeNull()
  })
})

describe('H12 全局汇总:novice/unknown 排除;状态栏记录数含 novice', () => {
  it('仅 novice(+unknown)档案:全局总览全零、不冒出最快五星;状态栏照数', () => {
    const records = [
      ...fillers(100, 0, 19),
      rec(100, 19, '迪卢克', 5), // novice 20 抽 1 金
      rec(1000, 20, '颂愿五星', 5), // unknown 1 金
    ]
    const view = buildHighlights(records)
    expect(view.journey).toEqual({ totalPulls: 0, fiveStars: 0, days: 0, since: null })
    expect(view.fastest).toBeNull()
    expect(view.touchBottoms).toBe(0)
    expect(view.guaranteed).toBeNull()
    expect(buildStatusBar(records)).toEqual({ recordCount: 21, since: '2022-08' })
  })

  it('unknown 作用域视图:多未知 code 归同一视图、原始 code 保留、五星计数', () => {
    const records = [
      rec(1000, 0, '颂愿三星', 3),
      rec(2000, 1, '颂愿五星', 5),
      rec(1000, 2, '颂愿四星', 4),
    ]
    const view = buildUnknownView(records)
    expect(view.totalPulls).toBe(3)
    expect(view.fiveStars).toBe(1)
    expect(view.records.map((line) => [line.pool, line.name])).toEqual([
      ['未收录祈愿 1000', '颂愿三星'],
      ['未收录祈愿 2000', '颂愿五星'],
      ['未收录祈愿 1000', '颂愿四星'],
    ])
  })
})

describe('旅途总览覆盖天数(日期部分首尾差 + 1,首尾同日 = 1 天)', () => {
  it('跨三日 → 3 天;同日 → 1 天;起始年月取首日', () => {
    const span = [
      row(200, '2022-05-01 23:00:00', '三星武器', 3),
      row(200, '2022-05-03 00:05:00', '三星武器', 3),
    ]
    const view = buildHighlights(span)
    expect(view.journey.days).toBe(3)
    expect(view.journey.since).toBe('2022-05')

    const sameDay = [
      row(200, '2022-05-01 08:00:00', '三星武器', 3),
      row(200, '2022-05-01 22:00:00', '三星武器', 3),
    ]
    expect(buildHighlights(sameDay).journey.days).toBe(1)
  })
})
