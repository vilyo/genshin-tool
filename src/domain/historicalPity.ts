import type { PoolCategory } from './pools'
import type { FiveStarPull } from './stats'

export type HistoricalPity = 'small' | 'guaranteed' | 'unknown' | null

/**
 * 本次出货前的保底类型,输入为作用域内时间正序五星(301/400 已合并)。
 * 首金 UP 无前序证据;歪可反证小保底。连续歪属缺口/异常,保留实际结果但不强判。
 * 其余池没有同一套大小保底语义。仅依据已保存历史,不推测缺失记录。
 */
export function historicalPities(scope: PoolCategory, fives: FiveStarPull[]): HistoricalPity[] {
  return fives.map((five, index) => {
    if (scope !== 'eventChar') return null
    const previous = fives[index - 1]
    if (five.off === null) return 'unknown'
    if (previous?.off === true) return five.off ? 'unknown' : 'guaranteed'
    if (five.off || previous?.off === false) return 'small'
    return 'unknown'
  })
}
