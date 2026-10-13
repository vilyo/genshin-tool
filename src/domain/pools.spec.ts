import { describe, expect, it } from 'vitest'
import {
  CHAR_HARD_PITY,
  EVENT_CHAR_POOLS,
  FOUR_STAR_HARD_PITY,
  WEAPON_HARD_PITY,
  hardPity,
  poolCategory,
  poolLabel,
} from './pools'

describe('poolLabel', () => {
  it('收录的 gacha_type 返回官方池名', () => {
    expect(poolLabel(100)).toBe('新手祈愿')
    expect(poolLabel(200)).toBe('常驻祈愿')
    expect(poolLabel(301)).toBe('角色活动祈愿')
    expect(poolLabel(400)).toBe('角色活动祈愿-2')
    expect(poolLabel(302)).toBe('武器活动祈愿')
    expect(poolLabel(500)).toBe('集录祈愿')
  })

  it('未知 code 容错兜底', () => {
    expect(poolLabel(999)).toBe('未收录祈愿 999')
  })
})

describe('poolCategory', () => {
  it('301/400 同为角色活动池(双池共享保底)', () => {
    expect(poolCategory(301)).toBe('eventChar')
    expect(poolCategory(400)).toBe('eventChar')
    expect(EVENT_CHAR_POOLS).toContain(400)
  })

  it('武器/集录/常驻/新手各归其类', () => {
    expect(poolCategory(302)).toBe('eventWeapon')
    expect(poolCategory(500)).toBe('chronicled')
    expect(poolCategory(200)).toBe('standard')
    expect(poolCategory(100)).toBe('novice')
  })

  it('未知 code 落入 unknown', () => {
    expect(poolCategory(0)).toBe('unknown')
  })
})

describe('hardPity', () => {
  it('武器池 80,其余按 90', () => {
    expect(hardPity(302)).toBe(WEAPON_HARD_PITY)
    expect(hardPity(301)).toBe(CHAR_HARD_PITY)
    expect(hardPity(400)).toBe(CHAR_HARD_PITY)
    expect(hardPity(200)).toBe(CHAR_HARD_PITY)
    expect(hardPity(500)).toBe(CHAR_HARD_PITY)
  })

  it('未知 code 按 90 兜底', () => {
    expect(hardPity(999)).toBe(CHAR_HARD_PITY)
  })

  it('四星保底全池 10', () => {
    expect(FOUR_STAR_HARD_PITY).toBe(10)
  })
})
