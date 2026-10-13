/**
 * 祈愿类型(卡池)领域知识。
 * gacha_type 为开放式枚举(接口返回字符串形如 "301",入库前归一为数字),
 * 官方加新池时落入 unknown 兜底,禁止按池名中文匹配。
 * 常量口径为社区共识,待研究票对照开源工具与官方公示核实后定稿。
 */

/** gacha_type → 官方池名(仅展示用);未收录 code 容错兜底 */
const POOL_LABELS: Record<number, string> = {
  100: '新手祈愿',
  200: '常驻祈愿',
  301: '角色活动祈愿',
  400: '角色活动祈愿-2',
  302: '武器活动祈愿',
  500: '集录祈愿',
}

export function poolLabel(code: number): string {
  return POOL_LABELS[code] ?? `未收录祈愿 ${code}`
}

/**
 * 池类别(统计口径与页签共用):固定类别 + 未知兜底。
 * eventChar 与 eventWeapon 是欧非统计(歪率/保底)的对象;
 * 301/400 为同期双角色池,共享保底进度与歪后必中状态,统计时须合并处理。
 */
export type PoolCategory =
  | 'eventChar' // 角色活动祈愿(301/400):五星 50/50,歪后必中
  | 'eventWeapon' // 武器活动祈愿(302):五星 75/25 + 定轨命运值(5.0 起 1 点满必中定轨武器,待核实)
  | 'chronicled' // 集录祈愿(500):复刻池,带定轨命运值,规则待核实
  | 'standard' // 常驻祈愿(200):无 UP 概念
  | 'novice' // 新手祈愿(100):仅 20 抽折扣池,规则特殊,不计入欧非总评
  | 'unknown'

export const EVENT_CHAR_POOLS: readonly number[] = [301, 400]
export const EVENT_WEAPON_POOLS: readonly number[] = [302]
export const CHRONICLED_POOLS: readonly number[] = [500]
export const STANDARD_POOLS: readonly number[] = [200]
export const NOVICE_POOLS: readonly number[] = [100]

const CATEGORY_BY_CODE: Record<number, PoolCategory> = {
  ...Object.fromEntries(EVENT_CHAR_POOLS.map((code) => [code, 'eventChar'])),
  ...Object.fromEntries(EVENT_WEAPON_POOLS.map((code) => [code, 'eventWeapon'])),
  ...Object.fromEntries(CHRONICLED_POOLS.map((code) => [code, 'chronicled'])),
  ...Object.fromEntries(STANDARD_POOLS.map((code) => [code, 'standard'])),
  ...Object.fromEntries(NOVICE_POOLS.map((code) => [code, 'novice'])),
}

export function poolCategory(code: number): PoolCategory {
  return CATEGORY_BY_CODE[code] ?? 'unknown'
}

/** 五星硬保底(抽):角色活动/常驻/新手通用 90 */
export const CHAR_HARD_PITY = 90
/** 五星硬保底(抽):武器活动祈愿为 80 */
export const WEAPON_HARD_PITY = 80
/** 四星保底(抽):全部池通用,V1 仅计数展示 */
export const FOUR_STAR_HARD_PITY = 10

/**
 * 五星硬保底按池取值;未知 code 按 90 兜底。
 * 集录祈愿(500)按 90 处理、新手祈愿(100)按 90 处理,均为待核实口径。
 */
export function hardPity(code: number): number {
  return poolCategory(code) === 'eventWeapon' ? WEAPON_HARD_PITY : CHAR_HARD_PITY
}
