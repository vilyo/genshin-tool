import { describe, expect, it } from 'vitest'
import { POOL_TABS, tabFor, visibleTabs } from './poolTabs'
import type { WishRecord } from './records'

function rec(gachaType: number, name = '三星武器', rankType = 3): WishRecord {
  return { gachaType, time: '2022-08-01 00:00:00', name, rankType, id: null }
}

describe('POOL_TABS 六页签(顺序与官方祈愿用语)', () => {
  it('顺序照 DESIGN §3 / spec §2 列表:novice 在 chronicled 之前', () => {
    expect(POOL_TABS.map((tab) => tab.scope)).toEqual([
      'eventChar',
      'eventWeapon',
      'standard',
      'novice',
      'chronicled',
      'unknown',
    ])
  })

  it('label 全部官方祈愿用语(与 pools.ts 池名同源;unknown 用兜底文案)', () => {
    expect(POOL_TABS.map((tab) => tab.label)).toEqual([
      '角色活动祈愿',
      '武器活动祈愿',
      '常驻祈愿',
      '新手祈愿',
      '集录祈愿',
      '未收录',
    ])
  })

  it('label 不含「抽卡」等非官方用语', () => {
    for (const tab of POOL_TABS) expect(tab.label).not.toContain('抽卡')
  })
})

describe('visibleTabs:「未收录」页签条件出现(H13 页签部分)', () => {
  it('空档案与无未知 code 档案:五个固定页签,无 unknown', () => {
    expect(visibleTabs([])).toHaveLength(5)
    const fixed = visibleTabs([rec(301), rec(302), rec(200), rec(100), rec(500)])
    expect(fixed.map((tab) => tab.scope)).not.toContain('unknown')
    expect(fixed).toHaveLength(5)
  })

  it('档案含未知 code(如颂愿系 1000)→ 第六页签「未收录」殿后', () => {
    const tabs = visibleTabs([rec(301), rec(1000, '颂愿五星', 5), rec(2000, '颂愿四星', 4)])
    expect(tabs).toHaveLength(6)
    expect(tabs[5]).toEqual({ scope: 'unknown', label: '未收录' })
  })

  it('不改写入参', () => {
    const input = [rec(1000, '颂愿五星', 5)]
    const snapshot = [...input]
    visibleTabs(input)
    expect(input).toEqual(snapshot)
  })
})

describe('tabFor 辅助', () => {
  it('与 POOL_TABS 逐项一致;unknown 不在显隐内也可取到', () => {
    for (const tab of POOL_TABS) expect(tabFor(tab.scope)).toEqual(tab)
    expect(tabFor('unknown')).toEqual({ scope: 'unknown', label: '未收录' })
  })
})
