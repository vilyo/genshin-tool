import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { makeBoardRecords } from '@/test-support/boardFixture'
import { useAppStore } from '@/stores/app'
import { useBoardStore } from '@/stores/board'

/**
 * 主画面 store(作用域/左栏视图/流水抽屉)。
 * 夹具数值依据见 test-support/boardFixture.ts 布局注释。
 */
function mountStores() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const app = useAppStore()
  const board = useBoardStore()
  app.records = makeBoardRecords()
  app.archives = [
    { uid: '777', createdAt: '2026-01-01T00:00:00Z', lastSyncedAt: '2026-10-02T21:30:00Z' },
  ]
  app.currentUid = '777'
  return { app, board }
}

describe('board store · 页签与作用域', () => {
  it('六页签:五固定页签常驻,档案有未知 code 时「未收录」出现(顺序钉死)', () => {
    const { board } = mountStores()
    expect(board.tabs.map((tab) => tab.label)).toEqual([
      '角色活动祈愿',
      '武器活动祈愿',
      '常驻祈愿',
      '新手祈愿',
      '集录祈愿',
      '未收录',
    ])
    // 页签计数 = 各作用域五星数(夹具:5/1/1/1/0/0)
    expect(board.tabCounts).toEqual({
      eventChar: 5,
      eventWeapon: 2,
      standard: 1,
      novice: 1,
      chronicled: 0,
      unknown: 0,
    })
  })

  it('无未知 code 时「未收录」不占位', () => {
    const { app, board } = mountStores()
    app.records = app.records.filter((record) => record.gachaType !== 1000)
    expect(board.tabs.map((tab) => tab.scope)).not.toContain('unknown')
    expect(board.tabs).toHaveLength(5)
  })

  it('作用域切换:统计/评级视图随页签走,换签复位 301/400 二级筛选', () => {
    const { board } = mountStores()
    expect(board.stats.scope).toBe('eventChar')
    board.setLedgerCode(400)
    board.selectScope('eventWeapon')
    expect(board.stats.scope).toBe('eventWeapon')
    expect(board.stats.pity).toMatchObject({ current: 5, hard: 80, softFrom: 63 })
    expect(board.verdict.displayRating).toBe('B') // 天空之翼 55 抽,武器档 54–62 → B
    expect(board.meterScale).toEqual({ hard: 80, bounds: [19, 40, 68] })
    expect(board.ledgerCode).toBeNull()
  })

  it('novice/unknown 无保底带(pity null),量距条分母按池常量兜底', () => {
    const { board } = mountStores()
    board.selectScope('novice')
    expect(board.stats.pity).toBeNull()
    expect(board.meterScale.hard).toBe(90)
    expect(board.activeTab.label).toBe('新手祈愿')
  })

  it('时间线行:新的在前 + 程度档 + C/R 标注经名册联查(不完整五星标 — 由组件处理)', () => {
    const { board } = mountStores()
    expect(board.timelineRows.map((row) => row.five.record.name)).toEqual([
      '莫娜',
      '迪卢克',
      '雷电将军',
      '那维莱特',
      '刻晴',
    ])
    expect(board.timelineRows.map((row) => row.degree)).toEqual([
      'unlucky',
      'unlucky',
      'superLucky',
      'lucky',
      'superLucky',
    ])
    // 夹具全为首次获取 → 无 C/R 标注;常驻池的迪卢克是全档案第 2 次 → C1
    expect(board.timelineRows.every((row) => row.tag === null)).toBe(true)
    board.selectScope('standard')
    expect(board.roster.cards.find((card) => card.name === '迪卢克')?.acquisitions[0]?.globalIndex).toBe(2)
  })

  it('最近同步时间取当前档案元数据', () => {
    const { board, app } = mountStores()
    expect(board.lastSyncedAt).toBe('2026-10-02T21:30:00Z')
    app.currentUid = null
    expect(board.lastSyncedAt).toBeNull()
  })
})

describe('board store · 流水抽屉', () => {
  it('全部记录倒序 + 分页(345 条 → 2 页,每页 200)', () => {
    const { board } = mountStores()
    expect(board.ledgerOpen).toBe(false)
    board.toggleLedger(true)
    expect(board.ledgerOpen).toBe(true)
    expect(board.ledgerRows).toHaveLength(345)
    expect(board.ledgerPageCount).toBe(2)
    expect(board.ledgerPageRows).toHaveLength(200)
    // 倒序:首条为生成序最末的 unknown 行
    expect(board.ledgerPageRows[0]?.gachaType).toBe(1000)
    board.nextLedgerPage()
    expect(board.ledgerEffectivePage).toBe(1)
    expect(board.ledgerPageRows).toHaveLength(145)
    board.nextLedgerPage()
    expect(board.ledgerEffectivePage).toBe(1) // 末页钳制
    board.prevLedgerPage()
    expect(board.ledgerEffectivePage).toBe(0)
  })

  it('仅五星筛选:9 条(含新手五星),切筛选回第一页', () => {
    const { board } = mountStores()
    board.toggleLedger(true)
    board.nextLedgerPage()
    board.setLedgerFiveOnly(true)
    expect(board.ledgerFiveOnly).toBe(true)
    expect(board.ledgerRows).toHaveLength(9)
    expect(board.ledgerEffectivePage).toBe(0)
    expect(board.ledgerRows.every((record) => record.rankType === 5)).toBe(true)
  })

  it('301/400 二级筛选只影响明细:400 档案实有 7 条,301 为其余 eventChar 行', () => {
    const { board } = mountStores()
    board.setLedgerCode(400)
    expect(board.ledgerRows.every((record) => record.gachaType === 400)).toBe(true)
    expect(board.ledgerRows).toHaveLength(7)
    board.setLedgerCode(301)
    expect(board.ledgerRows.every((record) => record.gachaType === 301)).toBe(true)
    expect(board.ledgerRows).toHaveLength(231 - 7)
    board.setLedgerCode(null)
    expect(board.ledgerRows).toHaveLength(345)
  })

  it('换作用域复位筛选与页码;统计作用域不受筛选影响(只影响明细展示)', () => {
    const { board } = mountStores()
    board.setLedgerCode(400)
    board.nextLedgerPage()
    board.selectScope('eventWeapon')
    expect(board.ledgerCode).toBeNull()
    expect(board.ledgerEffectivePage).toBe(0)
    // eventChar 统计(五星 5)不因流水筛选变化
    board.selectScope('eventChar')
    expect(board.stats.fives).toHaveLength(5)
  })

  it('左栏视图切换:时间线 ⇄ 名册', () => {
    const { board } = mountStores()
    expect(board.listView).toBe('timeline')
    board.setListView('roster')
    expect(board.listView).toBe('roster')
    board.setListView('timeline')
    expect(board.listView).toBe('timeline')
  })
})
