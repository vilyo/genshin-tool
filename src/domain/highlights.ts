/**
 * 高光时刻四卡 + 全局旅途总览 + 状态栏 + unknown 作用域视图(spec 04 §6)。
 * 全部纯函数、零框架依赖;五星序列/保底/大小保底来自 stats.computePoolStats。
 *
 * 口径要点(与鸣潮参考实现 wuwa highlights.ts 的差异,勿照抄):
 * - 旅途总览是**四作用域全局**(eventChar+eventWeapon+standard+chronicled):
 *   novice 不计入欧非总评与全局汇总、unknown 无统计口径(spec §0 #6/§2),均排除;
 *   鸣潮是全档案口径。
 * - 漫长等待 = **触底硬保底次数**:完整五星中 pulls ≥ 该作用域硬保底(90/80)的
 *   个数(DESIGN §5 定义),不是鸣潮的「最长单次」。
 * - 不完整五星(spec D2:作用域内首个五星恒 incomplete,pulls 是占位下界)不参与
 *   出手如电/漫长等待——假的下界会伪造「超欧」。
 * - 状态栏的最近同步时间是档案元数据,由 UI 从 StoragePort 取,domain 不管。
 */
import { poolCategory, poolLabel, type PoolCategory } from './pools'
import { compareRecords, type WishRecord } from './records'
import { computePoolStats, scopeRecords, type FiveStarPull } from './stats'
import { tabFor } from './poolTabs'

/** 旅途总览(spec §6:全局数据集 = eventChar+eventWeapon+standard+chronicled) */
export interface JourneySummary {
  /** 总抽数:四作用域记录行数(每行=一抽) */
  totalPulls: number
  /** 五星数:同数据集内五星行数 */
  fiveStars: number
  /** 覆盖天数:time 串日期部分首尾差 + 1(首尾同日 = 1 天);无记录 0 */
  days: number
  /** 起始年月:最早 time 串前 7 字符(YYYY-MM,服务器时区口径不转换);无记录 null */
  since: string | null
}

/** 出手如电纪念牌:全局最快完整五星(并列取比较器序更晚的一次) */
export interface FastestFiveCard {
  /** 五星名 */
  name: string
  /** 出货抽数(含出货那一抽) */
  pulls: number
  /** 出货日期(time 串前 10 字符,服务器时区口径,不转换) */
  date: string
  /** 官方池名(301/400 显示具体 code 名,与名册同口径) */
  pool: string
  /** UP/歪结局:仅 eventChar 五星有判定;其余作用域 null(UI 显池名即可,字段保留) */
  outcome: 'UP' | '歪' | null
}

/** 大保底就绪牌(spec §6:guarantee=guaranteed 时出牌,仅 eventChar) */
export interface GuaranteedCard {
  /** 池名:301/400 合并作用域的官方类目名「角色活动祈愿」(保底进度本就是合并口径) */
  pool: string
  /** 当前垫抽数(PoolStats.pity.current,池类型级跨期状态,不按卡池期重置) */
  current: number
  /** 距硬保底剩余抽数(hard − current;数据有洞时可能 ≤0,照实不钳制,spec D7) */
  remaining: number
}

/** 「n 抽内必中 UP」文案(spec §6;剩余抽数拼入,模板集中此处供 UI 复用) */
export function guaranteedReadyText(remaining: number): string {
  return `${remaining} 抽内必中 UP`
}

/** 高光时刻 2×2 视图(spec §6):旅途总览 + 出手如电 + 漫长等待 + 大保底就绪 */
export interface HighlightsView {
  journey: JourneySummary
  /** 出手如电:全局最快完整五星;四作用域均无完整五星时 null */
  fastest: FastestFiveCard | null
  /** 漫长等待:触底硬保底次数(完整五星,pulls ≥ 90/80 按池) */
  touchBottoms: number
  /** 大保底就绪:仅 eventChar 且 guarantee=guaranteed 时出牌,其余 null */
  guaranteed: GuaranteedCard | null
}

/** 状态栏数据(spec §6 / DESIGN §3.4) */
export interface StatusBarView {
  /** 记录数:档案全部行(含 novice/unknown) */
  recordCount: number
  /** 覆盖起点:全档案最早 time 串年月(YYYY-MM);无记录 null */
  since: string | null
}

/** unknown 作用域单行(spec §6:原始 code 展示) */
export interface UnknownRecordRow {
  name: string
  rankType: number
  /** time 原串,不转换 */
  time: string
  /** 官方池名兜底文案:未收录祈愿 {code}(pools.poolLabel) */
  pool: string
}

/** unknown 作用域视图(spec §6):仅计数与记录列表,无任何比率与评价 */
export interface UnknownView {
  totalPulls: number
  fiveStars: number
  /** 时间正序(与 stats 五星序列同向) */
  records: UnknownRecordRow[]
}

/** 全局汇总的四个作用域(spec §6:novice/unknown 排除) */
const GLOBAL_SCOPES: readonly PoolCategory[] = [
  'eventChar',
  'eventWeapon',
  'standard',
  'chronicled',
]

function inGlobalScope(record: WishRecord): boolean {
  return GLOBAL_SCOPES.includes(poolCategory(record.gachaType))
}

/** 覆盖天数:time 串日期部分(前 10 字符)按 Date.UTC 求首尾差 + 1(首尾同日 = 1 天) */
function coverageDays(earliest: string, latest: string): number {
  const dayMs = 86_400_000
  const utcMs = (date: string): number =>
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
  return (utcMs(latest) - utcMs(earliest)) / dayMs + 1
}

/**
 * 高光时刻四卡 + 全局旅途总览(spec §6):入参全档案,内部先滤出四作用域全局数据集。
 * 出手如电候选 = 四作用域完整五星,按比较器升序扫描、并列(≤)使更晚者胜出;
 * 漫长等待按各作用域 PoolStats.pity.hard(90/80)分池计数。
 */
export function buildHighlights(records: readonly WishRecord[]): HighlightsView {
  const global = records.filter(inGlobalScope)
  const asc = [...global].sort(compareRecords)
  const first = asc[0]
  const last = asc[asc.length - 1]
  const journey: JourneySummary = {
    totalPulls: global.length,
    fiveStars: global.reduce((count, record) => (record.rankType === 5 ? count + 1 : count), 0),
    days: first && last ? coverageDays(first.time, last.time) : 0,
    since: first ? first.time.slice(0, 7) : null,
  }

  const charStats = computePoolStats('eventChar', records)
  const weaponStats = computePoolStats('eventWeapon', records)
  const standardStats = computePoolStats('standard', records)
  const chronicledStats = computePoolStats('chronicled', records)
  const stats = [charStats, weaponStats, standardStats, chronicledStats]

  // 出手如电:完整五星为候选(不完整的 pulls 是占位下界,D2);并列取比较器序更晚者
  const candidates = stats.flatMap((poolStats) => poolStats.fives).filter((five) => !five.incomplete)
  candidates.sort((a, b) => compareRecords(a.record, b.record))
  let fastestFive: FiveStarPull | null = null
  for (const five of candidates) {
    if (fastestFive === null || five.pulls <= fastestFive.pulls) fastestFive = five
  }
  const fastest: FastestFiveCard | null = fastestFive
    ? {
        name: fastestFive.record.name,
        pulls: fastestFive.pulls,
        date: fastestFive.record.time.slice(0, 10),
        pool: poolLabel(fastestFive.record.gachaType),
        outcome: fastestFive.off === null ? null : fastestFive.off ? '歪' : 'UP',
      }
    : null

  // 漫长等待:完整五星 pulls ≥ 该作用域硬保底(90/80);无保底口径的作用域不计
  const touchBottoms = stats.reduce((count, poolStats) => {
    const hard = poolStats.pity?.hard
    if (hard === undefined) return count
    return (
      count +
      poolStats.fives.filter((five) => !five.incomplete && five.pulls >= hard).length
    )
  }, 0)

  // 大保底就绪:仅 eventChar guarantee=guaranteed 时出牌(D5;其余作用域恒 null)
  const pity = charStats.pity
  const guaranteed: GuaranteedCard | null =
    charStats.guarantee === 'guaranteed' && pity
      ? {
          pool: tabFor('eventChar').label,
          current: pity.current,
          remaining: pity.hard - pity.current,
        }
      : null

  return { journey, fastest, touchBottoms, guaranteed }
}

/** 状态栏数据(spec §6):记录数 = 档案全部行(含 novice);覆盖起点 = 全档案最早年月 */
export function buildStatusBar(records: readonly WishRecord[]): StatusBarView {
  let earliest: string | null = null
  for (const record of records) {
    if (earliest === null || record.time < earliest) earliest = record.time
  }
  return { recordCount: records.length, since: earliest === null ? null : earliest.slice(0, 7) }
}

/** unknown 作用域视图(spec §6):原始 code 展示(未收录祈愿 {code}),无比率无评价 */
export function buildUnknownView(records: readonly WishRecord[]): UnknownView {
  const asc = scopeRecords(records, 'unknown')
  return {
    totalPulls: asc.length,
    fiveStars: asc.filter((record) => record.rankType === 5).length,
    records: asc.map((record) => ({
      name: record.name,
      rankType: record.rankType,
      time: record.time,
      pool: poolLabel(record.gachaType),
    })),
  }
}
