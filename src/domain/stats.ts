/**
 * 统计引擎(spec 04 §3 D1–D8):作用域解析、五星序列、保底、大小保底、比率与均值。
 * 全部纯函数、零框架依赖;记录模型与比较器见 records.ts,歪判定见 standardRoster.ts。
 *
 * 与鸣潮参考实现(wuwa stats.ts)结构同构,两处口径差异按本 spec 勿照抄:
 * - incomplete(spec D2):本项目「作用域内首个五星恒不完整」——档案起点几乎总落在
 *   保底周期中间(接口保留期截断/Excel 未必从第一抽记起),首个五星的 pulls 是不可知
 *   下界;鸣潮是 i===0 窄口径,方向相反。
 * - 四星保底(spec D1):「10 抽必出四星或以上」,遇四星**或五星都清零**;
 *   鸣潮同款只数四星属常见错法,测试钉住(H5)。
 */
import { CHAR_HARD_PITY, WEAPON_HARD_PITY, poolCategory, type PoolCategory } from './pools'
import { compareRecords, type WishRecord } from './records'
import { standardVerdict } from './standardRoster'

/** 软保底起点:角色类池 74 抽起(社区强共识,官方仅公示综合概率) */
const CHAR_SOFT_PITY = 74
/** 软保底起点:武器活动池 63 抽起 */
const WEAPON_SOFT_PITY = 63

/** 单个五星的出货信息(时间正序) */
export interface FiveStarPull {
  record: WishRecord
  /** 出货抽数(含出货那一抽):自作用域内上一五星(或作用域起点)累计 */
  pulls: number
  /** 作用域内首个五星恒 true:更早历史不可见,pulls 是不可知下界(spec D2) */
  incomplete: boolean
  /** ADR-0003 反向歪判定;仅 eventChar 有值,其他作用域恒 null(spec §3) */
  off: true | false | null
  /** 名单可能过期旗标(ADR-0003 §4 兜底路径触发;仅 eventChar 可能出现) */
  rosterStale?: true
}

/** 五星保底进度对照(spec D7) */
export interface PityProgress {
  /** 自作用域内上一个五星之后的抽数;无五星时 = 作用域记录总数 */
  current: number
  /** 五星硬保底:角色类池 90 / 武器活动池 80 */
  hard: number
  /** 软保底起点(状态带软区):74 / 63 */
  softFrom: number
}

/** 单作用域统计结果(spec 04 §3 PoolStats) */
export interface PoolStats {
  scope: PoolCategory
  /** 合并明细保留的原始 code 列表(如 eventChar 为 [301, 400] 按档案实有,去重升序) */
  codes: number[]
  /** 该作用域的全部记录数 = 总抽数(每行=一抽) */
  totalPulls: number
  /** 五星出货列表,时间正序 */
  fives: FiveStarPull[]
  /** 平均出货(含出货那抽):仅完整五星(D3);无完整五星 null */
  avgPulls: number | null
  /** 平均出 UP(歪+随后必中合并为一组,D4):仅 eventChar;无有效组 null */
  avgUpPulls: number | null
  /** 歪率 0–1(D6):仅 eventChar;分母为 off≠null 的五星(含不完整五星,D2);分母 0 → null */
  offRate: number | null
  /**
   * 五星保底进度(D7);current 超 hard 属数据异常,照实显示不钳制。
   * 与 spec §3 的非空声明有一处裁定偏差:novice/unknown 按 §2「无保底带」置 null
   * (任务单裁决,报告已注明),其余作用域恒有值。
   */
  pity: PityProgress | null
  /** 四星保底计数(D1):距上次四星及以上的抽数(四星与五星都清零) */
  fourPity: { current: number }
  /** 大小保底状态(D5):仅 eventChar;guaranteed=大保底就绪 / fiftyFifty=小保底(保守) */
  guarantee: 'guaranteed' | 'fiftyFifty' | null
  /** 名单可能过期(ADR-0003 §4)的池级汇总:任一五星命中即 true。spec 仅条目级字段,
   *  池级汇总便于 UI 在评价区一次性提示(任务单裁决,报告已注明) */
  rosterStale?: true
}

/**
 * 作用域过滤 + 权威时序升序(spec §2:统计作用域 = 池类别,eventChar 合并 301+400)。
 * 排序副本,不改写入参;T16 页签/UI 复用同一数据集。
 */
export function scopeRecords(records: readonly WishRecord[], scope: PoolCategory): WishRecord[] {
  return records.filter((record) => poolCategory(record.gachaType) === scope).sort(compareRecords)
}

/** UP 成本组(D4):歪开组、UP 闭组;组内任一成员 incomplete 则整组排除出均值 */
interface UpPullGroup {
  pulls: number
  incomplete: boolean
}

/**
 * UP 出货分组(D4,仅 eventChar 调用):时间正序扫 fives——
 * off=true 开组,off=false 闭组成组(直接 UP 自成一组),结尾未闭合的歪丢弃
 * (该 UP 未出,由 pity/guarantee 表达);连续歪(理论不可能)取后一个开组,前者丢弃;
 * off=null(空名防御,H14 不可达路径)断组丢弃、不开新组。
 */
function upPullGroups(fives: readonly FiveStarPull[]): UpPullGroup[] {
  const groups: UpPullGroup[] = []
  let pending: FiveStarPull | null = null
  for (const five of fives) {
    if (five.off === null) {
      pending = null
      continue
    }
    if (five.off) {
      pending = five
      continue
    }
    const members = pending ? [pending, five] : [five]
    groups.push({
      pulls: members.reduce((sum, member) => sum + member.pulls, 0),
      incomplete: members.some((member) => member.incomplete),
    })
    pending = null
  }
  return groups
}

/**
 * 单作用域统计(spec §2/§3):记录集 = 按 poolCategory 归入 scope 的行,升序单趟扫描(D8 O(n))。
 */
export function computePoolStats(scope: PoolCategory, records: readonly WishRecord[]): PoolStats {
  const asc = scopeRecords(records, scope)
  const codes = [...new Set(asc.map((record) => record.gachaType))].sort((a, b) => a - b)

  // D1:五星序列与四星保底同趟累计;四星计数遇四星或五星都清零(反「只数四星」)
  const fives: FiveStarPull[] = []
  let sinceLastFive = 0
  let sinceLastFour = 0
  let rosterStale = false
  for (const record of asc) {
    sinceLastFive += 1
    sinceLastFour += 1
    if (record.rankType === 5) {
      // 歪判定仅 eventChar(§2 表);其余作用域 off 恒 null
      const verdict = scope === 'eventChar' ? standardVerdict(record) : null
      fives.push({
        record,
        pulls: sinceLastFive,
        // D2:作用域内首个五星恒不完整(无论它是否作用域首条)
        incomplete: fives.length === 0,
        off: verdict ? verdict.off : null,
        ...(verdict?.rosterStale ? { rosterStale: true as const } : {}),
      })
      if (verdict?.rosterStale) rosterStale = true
      sinceLastFive = 0
      sinceLastFour = 0
    } else if (record.rankType === 4) {
      sinceLastFour = 0
    }
  }

  // D4:UP 分组仅 eventChar;组内任一成员 incomplete → 整组排除出均值
  const validGroups =
    scope === 'eventChar' ? upPullGroups(fives).filter((group) => !group.incomplete) : []
  // D3:仅完整五星参与平均出货
  const complete = fives.filter((five) => !five.incomplete)
  // D6:歪率分母 = off≠null 的五星(含不完整五星,判定与抽数无关)
  const eligible = fives.filter((five) => five.off !== null)
  const last = fives[fives.length - 1]

  return {
    scope,
    codes,
    totalPulls: asc.length,
    fives,
    avgPulls:
      complete.length > 0
        ? complete.reduce((sum, five) => sum + five.pulls, 0) / complete.length
        : null,
    avgUpPulls:
      validGroups.length > 0
        ? validGroups.reduce((sum, group) => sum + group.pulls, 0) / validGroups.length
        : null,
    offRate:
      scope === 'eventChar' && eligible.length > 0
        ? eligible.filter((five) => five.off === true).length / eligible.length
        : null,
    // D7:novice/unknown 无保底带(§2,裁定置 null);hard 按作用域 90/80,softFrom 74/63
    pity:
      scope === 'novice' || scope === 'unknown'
        ? null
        : {
            current: sinceLastFive,
            hard: scope === 'eventWeapon' ? WEAPON_HARD_PITY : CHAR_HARD_PITY,
            softFrom: scope === 'eventWeapon' ? WEAPON_SOFT_PITY : CHAR_SOFT_PITY,
          },
    fourPity: { current: sinceLastFour },
    // D5:末个五星 off=true → guaranteed;off=false/无五星/判定未知 → 保守 fiftyFifty
    guarantee: scope === 'eventChar' ? (last?.off === true ? 'guaranteed' : 'fiftyFifty') : null,
    ...(rosterStale ? { rosterStale: true as const } : {}),
  }
}
