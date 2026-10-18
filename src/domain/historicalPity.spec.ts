import { describe, expect, it } from 'vitest'
import { storedRecord } from '@/test-support/appFakes'
import type { FiveStarPull } from './stats'
import { historicalPities } from './historicalPity'

function five(off: boolean | null, gachaType = 301): FiveStarPull {
  return { record: storedRecord({ gachaType, rankType: 5 }), pulls: 8, off }
}

describe('历史出货保底类型', () => {
  it('首金 UP 待确认;首金歪可反证小保底', () => {
    expect(historicalPities('eventChar', [five(false)])).toEqual(['unknown'])
    expect(historicalPities('eventChar', [five(true)])).toEqual(['small'])
  })

  it('301/400 共享:歪后下一金大保底,再下一金恢复小保底,与抽数无关', () => {
    expect(historicalPities('eventChar', [five(true, 301), five(false, 400), five(false, 301)]))
      .toEqual(['small', 'guaranteed', 'small'])
  })

  it('连续歪/未知前序不伪造必中,保留异常行后的已知状态', () => {
    expect(historicalPities('eventChar', [five(true), five(true), five(false), five(null), five(false)]))
      .toEqual(['small', 'unknown', 'guaranteed', 'unknown', 'unknown'])
  })

  it('武器/常驻/新手/集录/未知池不套用角色保底语义;空历史为空', () => {
    for (const scope of ['eventWeapon', 'standard', 'novice', 'chronicled', 'unknown'] as const) {
      expect(historicalPities(scope, [five(true), five(false)])).toEqual([null, null])
    }
    expect(historicalPities('eventChar', [])).toEqual([])
  })
})
