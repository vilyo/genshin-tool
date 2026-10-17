/**
 * 评级/程度分档/评语(spec 04 §5 D9–D12):档表、修正项、彩蛋与文案常量集中一处。
 * 全部纯函数、纯本地规则模板,无任何在线调用与 AI 生成(PRD F3 硬约束)。
 *
 * 单一来源约定(spec §5):degreeOf 供名册数字/量距条着色与「超欧 n · 超非 n」芯片共用;
 * ratingOf 与评语库供评语行(V5 VerdictSeal)使用;期望参考线常量在 novice 有平均出货时
 * 同样对照(novice 不评级,仅共享常量)。
 */
import type { PoolCategory } from './pools'
import type { FiveStarPull, PoolStats } from './stats'

/** 程度四档(DESIGN §5 定稿):超欧/欧/正常/超非,命名与档名一一对应 */
export type Degree = 'superLucky' | 'lucky' | 'normal' | 'unlucky'

/** 评级五档(DESIGN §5 定稿):S/A/B/C/D */
export type Rating = 'S' | 'A' | 'B' | 'C' | 'D'

/** 程度档阈值(各上限均含):超欧 ≤superLuckyMax / 欧 ≤luckyMax / 正常 ≤normalMax / 其余超非 */
interface DegreeLadder {
  superLuckyMax: number
  luckyMax: number
  normalMax: number
}

/** 角色类池档表(90 保底:eventChar/standard/chronicled/novice,unknown 同类兜底) */
const CHAR_DEGREE_LADDER: DegreeLadder = { superLuckyMax: 22, luckyMax: 45, normalMax: 76 }
/** 武器活动池档表(80 保底,仅 eventWeapon) */
const WEAPON_DEGREE_LADDER: DegreeLadder = { superLuckyMax: 19, luckyMax: 40, normalMax: 68 }

/**
 * 单次五星出货抽数的程度四档(D9;DESIGN §5 定稿,名册数字/量距条着色与芯片共用)。
 * 仅 eventWeapon 走武器档,其余作用域(含 unknown,与 pools.hardPity 的 90 兜底一致)
 * 走角色类档。
 */
export function degreeOf(pulls: number, scope: PoolCategory): Degree {
  const ladder = scope === 'eventWeapon' ? WEAPON_DEGREE_LADDER : CHAR_DEGREE_LADDER
  if (pulls <= ladder.superLuckyMax) return 'superLucky'
  if (pulls <= ladder.luckyMax) return 'lucky'
  if (pulls <= ladder.normalMax) return 'normal'
  return 'unlucky'
}

/** 期望参考线(抽):角色类池 62.5 = 官方公示五星综合概率 1.6% 的倒数(DESIGN §8 已核实) */
export const EVENT_CHAR_EXPECTED = 62.5
/** 期望参考线(抽):武器活动池 53.25 = 社区软保底模型口径(官方综合概率 1.85% 的上界 54.05) */
export const EVENT_WEAPON_EXPECTED = 53.25

/** 评级档阈值(各上限均含):S ≤sMax / A ≤aMax / B ≤bMax / C ≤cMax / 其余 D */
interface RatingLadder {
  sMax: number
  aMax: number
  bMax: number
  cMax: number
}

/** 角色活动档表(仅 eventChar) */
const CHAR_RATING_LADDER: RatingLadder = { sMax: 45, aMax: 62, bMax: 72, cMax: 77 }
/** 武器活动档表(仅 eventWeapon) */
const WEAPON_RATING_LADDER: RatingLadder = { sMax: 40, aMax: 53, bMax: 62, cMax: 71 }

/**
 * 五星平均出货的评级(D10;DESIGN §5 定稿)。仅 eventChar/eventWeapon 评级,其余作用域
 * 恒 null(「—」由 UI 渲染);无完整五星(avgPulls null)同样按 null 处理,由 applyVerdict 统一落。
 */
export function ratingOf(avgPulls: number, scope: PoolCategory): Rating | null {
  const ladder =
    scope === 'eventChar' ? CHAR_RATING_LADDER : scope === 'eventWeapon' ? WEAPON_RATING_LADDER : null
  if (ladder === null) return null
  if (avgPulls <= ladder.sMax) return 'S'
  if (avgPulls <= ladder.aMax) return 'A'
  if (avgPulls <= ladder.bMax) return 'B'
  if (avgPulls <= ladder.cMax) return 'C'
  return 'D'
}

/** 评语文案库(D12;DESIGN §5 定稿方向起句补全成句,五档各一条,纯本地模板) */
export const RATING_COMMENTS: Record<Rating, string> = {
  S: '众星俯首,金光应声而至——你正是提瓦特命运之章的宠儿。',
  A: '星辰大致守约,金光偶有迟到,却从未在旅途中缺席。',
  B: '不疾不徐,缘分自有安排,每一抹金色都在属于它的那一抽等你。',
  C: '保底的尽头快到了,深呼吸,命运正在酝酿一场盛大的相遇。',
  D: '非到深处自然神,愿风神护佑,下一个九十抽必有金光破云。',
}

/** 歪率修正阈值(D11):eventChar 且 offRate ≥ 60% 触发「降半档」 */
export const OFF_RATE_CORRECTION_THRESHOLD = 0.6

/** 歪率修正的降档映射;D 不再降(「D+」不存在,映射到自身即不产生展示变化) */
const NEXT_LOWER_RATING: Record<Rating, Rating> = { S: 'A', A: 'B', B: 'C', C: 'D', D: 'D' }

/** 低抽数彩蛋阈值(D11):作用域内最快完整五星 ≤10 抽触发 */
export const EASTER_EGG_MAX_PULLS = 10

/** 捕获明光固定脚注(D11;仅口径说明,不声称可识别明光命中,spec §0 #11) */
export const CAPTURE_RADIANCE_FOOTNOTE = '5.0 起含捕获明光,期望歪率 45%'

/** 大保底就绪状态徽章文案(D11;「n 抽内必中 UP」的详细牌面归 highlights,T16) */
export const GUARANTEED_BADGE = '大保底就绪 · 下个五星必为 UP'

/** 名单可能过期提示(ADR-0003 §4 兜底路径;提示更新应用后重算) */
export const ROSTER_STALE_HINT = '常驻名单可能已过期,新五星或被误判为 UP,请更新应用'

/** 低抽数彩蛋徽章数据(作用域内最快完整五星) */
export interface EasterEggBadge {
  /** 五星名 */
  name: string
  /** 出货抽数(含出货那一抽) */
  pulls: number
  /** 出货日期(time 串日期部分,服务器时区口径) */
  date: string
}

/** 评语行视图模型(D11/D12):applyVerdict 的唯一输出,评语行组件的单一输入 */
export interface VerdictView {
  scope: PoolCategory
  /** 原始评级(修正前);不评级作用域或无完整五星时 null(UI 渲染「—」) */
  rating: Rating | null
  /** 显示评级:歪率修正后为下一档字母加「+」;无修正时与 rating 相同 */
  displayRating: string | null
  /** 修正说明(含实际歪率百分比);未触发修正、或 D 档无可再降时 null */
  correction: string | null
  /** 评语主文案:按显示档位取文案库(修正后取降后档位);不评级 null */
  comment: string | null
  /** 五星平均出货(含出货那抽),透传 stats.avgPulls */
  avgPulls: number | null
  /** 低抽数彩蛋徽章;未触发 null */
  easterEgg: EasterEggBadge | null
  /** 大保底就绪状态徽章(guarantee === 'guaranteed',仅 eventChar 可能成立);文案 GUARANTEED_BADGE */
  guaranteed: boolean
  /** 名单可能过期(ADR-0003 §4 池级旗标透传);提示文案 ROSTER_STALE_HINT */
  rosterStale: boolean
  /** 捕获明光固定脚注(常量引用;显隐与位置由 UI 决定) */
  footnote: string
}

/** 歪率百分比文案:保留一位小数并去掉尾 .0(0.6 → 60,0.625 → 62.5) */
function offRatePercent(offRate: number): string {
  return (offRate * 100).toFixed(1).replace(/\.0$/, '')
}

/** 作用域内最快五星(低抽数彩蛋候选;并列取更晚的) */
function fastestFive(fives: readonly FiveStarPull[]): FiveStarPull | null {
  let best: FiveStarPull | null = null
  for (const five of fives) {
    if (five.pulls > EASTER_EGG_MAX_PULLS) continue
    if (best === null || five.pulls <= best.pulls) best = five
  }
  return best
}

/**
 * 由统计结果组装评语行视图(D11 修正项与彩蛋 + D12 评语,spec §5):
 * - 歪率修正仅 eventChar:offRate ≥ 60% 时显示评级降为下一档字母加「+」、评语改降后档位
 *   文案,并附含实际百分比的修正说明;D 档不再降,无可展示的降档则不追加修正说明;
 * - 不评级作用域(常驻/新手/集录/未收录)评级与评语落 null,由 UI 显示「—」;
 *   彩蛋/大保底就绪/名单过期提示不依赖评级,照常输出。
 */
export function applyVerdict(stats: PoolStats): VerdictView {
  const rating = stats.avgPulls !== null ? ratingOf(stats.avgPulls, stats.scope) : null

  let displayRating: string | null = rating
  let comment = rating === null ? null : RATING_COMMENTS[rating]
  let correction: string | null = null
  if (
    rating !== null &&
    stats.scope === 'eventChar' &&
    stats.offRate !== null &&
    stats.offRate >= OFF_RATE_CORRECTION_THRESHOLD
  ) {
    const lowered = NEXT_LOWER_RATING[rating]
    if (lowered !== rating) {
      displayRating = `${lowered}+`
      comment = RATING_COMMENTS[lowered]
      correction = `歪率 ${offRatePercent(stats.offRate)}%,评级降半档`
    }
  }

  const fastest = fastestFive(stats.fives)
  return {
    scope: stats.scope,
    rating,
    displayRating,
    correction,
    comment,
    avgPulls: stats.avgPulls,
    easterEgg: fastest
      ? {
          name: fastest.record.name,
          pulls: fastest.pulls,
          date: fastest.record.time.slice(0, 10),
        }
      : null,
    guaranteed: stats.guarantee === 'guaranteed',
    rosterStale: stats.rosterStale === true,
    footnote: CAPTURE_RADIANCE_FOOTNOTE,
  }
}
