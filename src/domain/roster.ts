/**
 * 五星名册(spec 04 §4):作用域内五星按物品分组的卡片视图 + 顶部汇总芯片计数。
 * 全部纯函数、零框架依赖;五星序列来自 stats.computePoolStats,程度档来自 verdict.degreeOf。
 *
 * 口径要点:
 * - 命之座/精炼是**跨池全局序**(spec §0 #10):第 k 次获取按全档案比较器时序计数,
 *   故 buildRoster 接收全档案 records(而非作用域过滤后的),内部先算作用域五星、
 *   再用全档案序号标注;C/R 封顶换算导出为 constellationOf/refinementOf,
 *   kind(角色/武器)不进 domain——名单判定属歪判定语义,名册不依赖,选用归 UI 图标层(T17)。
 * - 获取列表新的在前(时间倒序,与时间线同序);出货记录独立逐条列出,
 *   绝不合并不丢数(PRD §9 决策 9)。
 * - 与鸣潮参考实现(wuwa roster.ts)的差异:off 仅 eventChar 有值;globalIndex 为跨池
 *   全局口径;C6/R5 封顶为原神机制;无微条/参考线/重复章等鸣潮特有视图字段。
 */
import { poolLabel, type PoolCategory } from './pools'
import { compareRecords, type WishRecord } from './records'
import { computePoolStats } from './stats'
import { degreeOf } from './verdict'

/** 命之座换算(spec §0 #10):全档案第 k 次获取 → C min(k−1, 6),1 命起算、7 命起封顶 */
export function constellationOf(k: number): number {
  return Math.min(k - 1, 6)
}

/** 精炼换算(spec §0 #10):全档案第 k 次获取 → R min(k−1, 5),1 精起算、6 精起封顶 */
export function refinementOf(k: number): number {
  return Math.min(k - 1, 5)
}

/** 命座/精炼尾注(spec §4):标注口径说明,不改变任何计数 */
export const ROSTER_CONSTELLATION_NOTE = '仅按祈愿记录累计,与游戏内实际命座可能因活动赠送差 1'

/** 卡片内单次获取条目(spec §4) */
export interface Acquisition {
  /** 出货抽数(含出货那一抽);incomplete 时为占位下界,UI 显「—」(spec D2) */
  pulls: number
  /** 作用域内首个五星恒 true:更早历史不可见(spec D2) */
  incomplete: boolean
  /** 歪/不歪章数据源:仅 eventChar 有值,其余作用域恒 null、UI 不显示(spec §2) */
  off: true | false | null
  /** 出货日期(time 串前 10 字符,服务器时区口径,不转换) */
  date: string
  /** 官方池名;301/400 显示具体 code 名(同保底但卡池期不同,明细保留原始 code) */
  pool: string
  /** 该物品在全档案跨池全局时序中的第 k 次获取(1 起);C/R 由 constellationOf/refinementOf 换算 */
  globalIndex: number
}

/** 单张名册卡片 = 一个物品;kind 不进 domain(角色/武器的图标映射归 T17 UI 层) */
export interface RosterCard {
  /** 物品名(API 强制 zh-cn,恒中文) */
  name: string
  /** 获取列表,新的在前(时间倒序);逐条独立,不合并不丢数 */
  acquisitions: Acquisition[]
}

/** 顶部汇总芯片计数(spec §4:UP n · 歪 n · 超欧 n · 超非 n) */
export interface RosterSummary {
  /** UP 数(off===false):仅 eventChar 计数,其余作用域 null(UI 隐藏芯片) */
  up: number | null
  /** 歪数(off===true,含不完整五星,与 D6 歪率分母同口径):仅 eventChar,其余 null */
  off: number | null
  /** 超欧数:完整五星按 degreeOf 分档(不完整五星 pulls 是占位下界,不参与) */
  superLucky: number
  /** 超非数:同上 */
  unlucky: number
}

/** 名册视图:卡片列表(新的在前)+ 汇总芯片 */
export interface RosterView {
  scope: PoolCategory
  cards: RosterCard[]
  summary: RosterSummary
}

/**
 * 全档案五星获取的全局序(spec §0 #10):按比较器升序扫全档案,仅数五星行
 * (同名物品星级恒定,四星/三星行与命座/精炼无关),返回 记录 → 该物品第 k 次(1 起)。
 * 同秒同名按比较器稳定序(输入序)。
 */
function globalIndexes(records: readonly WishRecord[]): Map<WishRecord, number> {
  const seqByName = new Map<string, number>()
  const byRecord = new Map<WishRecord, number>()
  for (const record of [...records].sort(compareRecords)) {
    if (record.rankType !== 5) continue
    const k = (seqByName.get(record.name) ?? 0) + 1
    seqByName.set(record.name, k)
    byRecord.set(record, k)
  }
  return byRecord
}

/**
 * 五星名册视图(spec §4):作用域五星来自 computePoolStats(scope, records),
 * globalIndex 按全档案 records 跨池计数——故入参必须是全档案,不能预过滤。
 * 卡片分组按时间倒序扫五星、首见建卡(卡片序 = 各物品最新一次获取的时间倒序);
 * 芯片由 stats + verdict 派生(up/off 数 off 非 null 的五星,超欧/超非数完整五星)。
 */
export function buildRoster(scope: PoolCategory, records: readonly WishRecord[]): RosterView {
  const stats = computePoolStats(scope, records)
  const indexByRecord = globalIndexes(records)

  const cards: RosterCard[] = []
  const cardByName = new Map<string, RosterCard>()
  for (let i = stats.fives.length - 1; i >= 0; i -= 1) {
    const five = stats.fives[i]!
    let card = cardByName.get(five.record.name)
    if (!card) {
      card = { name: five.record.name, acquisitions: [] }
      cardByName.set(five.record.name, card)
      cards.push(card)
    }
    card.acquisitions.push({
      pulls: five.pulls,
      incomplete: five.incomplete,
      off: five.off,
      date: five.record.time.slice(0, 10),
      pool: poolLabel(five.record.gachaType),
      globalIndex: indexByRecord.get(five.record)!,
    })
  }

  const complete = stats.fives.filter((five) => !five.incomplete)
  const summary: RosterSummary = {
    up: scope === 'eventChar' ? stats.fives.filter((five) => five.off === false).length : null,
    off: scope === 'eventChar' ? stats.fives.filter((five) => five.off === true).length : null,
    superLucky: complete.filter((five) => degreeOf(five.pulls, scope) === 'superLucky').length,
    unlucky: complete.filter((five) => degreeOf(five.pulls, scope) === 'unlucky').length,
  }
  return { scope, cards, summary }
}
