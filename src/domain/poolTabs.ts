/**
 * 池页签模型(spec 04 §2 / DESIGN §3):六页签——角色活动(301/400 合并)、武器活动、
 * 常驻、新手、集录、未收录(未知 code 兜底)。全部纯函数、零框架依赖。
 *
 * - 展示顺序钉死(DESIGN §3 与 spec §2 列表一致):eventChar、eventWeapon、standard、
 *   novice、chronicled、unknown——注意 novice 在 chronicled **之前**(与 spec §2 表格
 *   行序、PoolCategory 类型声明序不同,以两处列表为准,任务单已裁定)。
 * - 页签归属只看 gacha_type 数字 code 的 poolCategory,禁止按池名中文匹配(AGENTS 领域要点)。
 * - 流水内 301/400 二级筛选只影响明细展示,不改变页签集与任何统计(spec §2,T17 UI 落)。
 */
import { poolCategory, poolLabel, type PoolCategory } from './pools'
import type { WishRecord } from './records'

/** 单个页签的视图模型 */
export interface PoolTab {
  scope: PoolCategory
  /** 页签文案(官方祈愿用语;unknown 为兜底文案「未收录」) */
  label: string
}

/** 固定作用域页签的代表 code:label 复用 pools.ts 官方池名(单一来源,不另写文案表) */
const TAB_MAIN_CODE: Record<Exclude<PoolCategory, 'unknown'>, number> = {
  eventChar: 301,
  eventWeapon: 302,
  standard: 200,
  novice: 100,
  chronicled: 500,
}

/**
 * 六页签常量表(顺序 = 展示顺序,见文件头说明)。
 * label 取代表 code 的官方池名;eventChar 合并 301/400,页签用类目名「角色活动祈愿」。
 */
export const POOL_TABS: ReadonlyArray<PoolTab> = [
  { scope: 'eventChar', label: poolLabel(TAB_MAIN_CODE.eventChar) },
  { scope: 'eventWeapon', label: poolLabel(TAB_MAIN_CODE.eventWeapon) },
  { scope: 'standard', label: poolLabel(TAB_MAIN_CODE.standard) },
  { scope: 'novice', label: poolLabel(TAB_MAIN_CODE.novice) },
  { scope: 'chronicled', label: poolLabel(TAB_MAIN_CODE.chronicled) },
  { scope: 'unknown', label: '未收录' },
]

const TAB_BY_SCOPE = Object.fromEntries(
  POOL_TABS.map((tab) => [tab.scope, tab] as const),
) as Record<PoolCategory, PoolTab>

/** 按作用域取页签(六个作用域在 POOL_TABS 中恒有定义;与页签显隐无关,unknown 也可取) */
export function tabFor(scope: PoolCategory): PoolTab {
  return TAB_BY_SCOPE[scope]
}

/**
 * 页签列表(spec §2):五个固定页签常驻(空档案也显示,内容区走空态,T17);
 * 「未收录」仅当档案中确有未知 code 记录时出现,不占位。
 */
export function visibleTabs(records: readonly WishRecord[]): PoolTab[] {
  const hasUnknown = records.some((record) => poolCategory(record.gachaType) === 'unknown')
  return hasUnknown ? [...POOL_TABS] : POOL_TABS.filter((tab) => tab.scope !== 'unknown')
}
