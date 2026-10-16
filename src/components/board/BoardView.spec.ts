import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import { makeBoardRecords } from '@/test-support/boardFixture'
import type { StoredRecord } from '@/domain/records'
import type { ArchiveSummary } from '@/domain/ports'
import { useAppStore } from '@/stores/app'
import { useBoardStore } from '@/stores/board'
import BoardView from './BoardView.vue'
import { storedRecord } from '@/test-support/appFakes'

/**
 * 主画面冒烟(V5 主版面装配):给定合成档案(boardFixture,数值依据见其布局注释),
 * 校验六页签/保底仪/时间线量距条/评语/高光/状态栏/名册切换/流水抽屉的渲染与交互。
 */
const ARCHIVES: ArchiveSummary[] = [
  { uid: '777', createdAt: '2026-01-01T00:00:00Z', lastSyncedAt: '2026-10-02T21:30:00Z' },
]

function mountBoard() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const app = useAppStore()
  app.records = makeBoardRecords()
  app.archives = ARCHIVES
  app.currentUid = '777'
  const wrapper = mount(BoardView, { global: { plugins: [pinia] } })
  return { wrapper, board: useBoardStore() }
}

/** 自定义种子挂载(返工用例:rosterStale 提示行/保底仪缺口提示) */
function mountWith(records: StoredRecord[]) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const app = useAppStore()
  app.records = records
  app.archives = ARCHIVES
  app.currentUid = '777'
  const wrapper = mount(BoardView, { global: { plugins: [pinia] } })
  return { wrapper, board: useBoardStore() }
}

function tabByText(wrapper: ReturnType<typeof mountBoard>['wrapper'], label: string) {
  return wrapper.findAll('.pool-tab').find((tab) => tab.find('.tab-label').text() === label)!
}

describe('BoardView · 页签/保底仪/时间线/评语/高光/状态栏', () => {
  it('六页签渲染:官方池名顺序 + 五星计数角标(新手祈愿不标)', () => {
    const { wrapper } = mountBoard()
    const labels = wrapper.findAll('.pool-tab .tab-label').map((label) => label.text())
    expect(labels).toEqual([
      '角色活动祈愿',
      '武器活动祈愿',
      '常驻祈愿',
      '新手祈愿',
      '集录祈愿',
      '未收录',
    ])
    const counts = wrapper.findAll('.pool-tab').map((tab) => {
      const count = tab.find('.tab-ct')
      return count.exists() ? count.text() : ''
    })
    expect(counts).toEqual(['5', '2', '1', '', '0', '0'])
    expect(wrapper.find('.pool-tab.on .tab-label').text()).toBe('角色活动祈愿')
  })

  it('保底仪:大数字垫抽 30 + 大保底就绪章 + 301+400 合并结算 + 次级读数组', () => {
    const { wrapper } = mountBoard()
    expect(wrapper.find('.pity-val').text()).toBe('30')
    expect(wrapper.text()).toContain('大保底就绪 · 下一金必中')
    expect(wrapper.find('.pity-meta').text()).toBe('301 + 400 合并结算')
    const reads = wrapper.findAll('.read').map((read) => read.text())
    expect(reads[0]).toContain('距软保底')
    expect(reads[0]).toContain('44')
    expect(reads[1]).toContain('60')
    expect(reads[2]).toContain('/ 10')
    // 刻度轨:软区斜纹自 74 起(82.2%),游标停在 30/90(33.3%)
    expect(wrapper.find('.scale-soft').attributes('style')).toContain('82.22')
    expect(wrapper.find('.scale-cursor').attributes('style')).toContain('33.33')
  })

  it('时间线:5 行新的在前,量距条档色 class 对齐 degreeOf,歪/不歪章仅 eventChar', () => {
    const { wrapper } = mountBoard()
    const rows = wrapper.findAll('.wish-row')
    expect(rows).toHaveLength(5)
    const degrees = rows.map((row) => row.find('.wish-degree').classes())
    expect(degrees.map((classes) => classes.includes('deg-unlucky'))).toEqual([true, true, false, false, false])
    // 刻晴行(不完整)档位词仍按 degreeOf(单一来源)着色,pulls 显「—」
    expect(degrees.map((classes) => classes.includes('deg-super-lucky'))).toEqual([false, false, true, false, true])
    expect(degrees.map((classes) => classes.includes('deg-lucky'))).toEqual([false, false, false, true, false])
    // 稀有行洗色:超非/超非(莫娜、迪卢克),超欧(雷电将军)
    expect(rows[0]!.classes()).toContain('rare-unlucky')
    expect(rows[1]!.classes()).toContain('rare-unlucky')
    expect(rows[2]!.classes()).toContain('rare-super-lucky')
    // 不完整行:pulls 显「—」、量距条半透明,不洗稀有底
    const incomplete = rows[4]!
    expect(incomplete.find('.wish-q').text()).toBe('—')
    expect(incomplete.find('.meter').classes()).toContain('incomplete')
    expect(incomplete.classes()).not.toContain('rare-unlucky')
    // 歪章:3 歪 2 不歪;档位词/数字列轨渲染
    expect(wrapper.findAll('.wish-bd.ok')).toHaveLength(2)
    expect(wrapper.findAll('.wish-bd.lost')).toHaveLength(3)
    expect(rows[2]!.find('.wish-q').text()).toBe('8')
    // 头部计数徽章(完整五星):超欧 1 / 超非 2
    const badges = wrapper.find('.th-badges').text()
    expect(badges).toContain('超欧 1')
    expect(badges).toContain('超非 2')
  })

  it('评语区:修正后评级 B+ + 降档文案 + 修正徽章 + 印签 + 口径行 + 明光脚注', () => {
    const { wrapper } = mountBoard()
    expect(wrapper.find('.dial-letter').text()).toBe('B+')
    expect(wrapper.find('.v1').text()).toContain('评级 B+')
    expect(wrapper.find('.v1').text()).toContain('不疾不徐')
    expect(wrapper.find('.v2').text()).toContain('平均出货 50')
    expect(wrapper.find('.v2').text()).toContain('期望参考 62.5(官方综合概率倒数)')
    const stamps = wrapper.findAll('.stamp').map((stamp) => stamp.text())
    expect(stamps).toEqual(['超欧 ×1', '欧 ×1', '正常 ×0', '超非 ×2'])
    expect(wrapper.find('.vp-badge.warn').text()).toBe('歪率 60%,评级降半档')
    expect(wrapper.find('.vp-badge.egg').text()).toContain('雷电将军 8 抽')
    expect(wrapper.find('.vp-badge.jade').text()).toContain('大保底就绪')
    expect(wrapper.find('.vp-footnote').text()).toContain('捕获明光')
    // 指标瓦片:总祈愿 231 / 五星 5 / 平均出货 50 / 歪率 60
    const tiles = wrapper.findAll('.tile').map((tile) => tile.text())
    expect(tiles[0]).toContain('231')
    expect(tiles[1]).toContain('5')
    expect(tiles[2]).toContain('50')
    expect(tiles[3]).toContain('60')
  })

  it('高光时刻 2×2:旅途总览 342 抽 / 出手如电 8 抽 / 触底 1 / 大保底就绪 60 抽内必中 UP', () => {
    const { wrapper } = mountBoard()
    const cards = wrapper.findAll('.hl-card')
    expect(cards).toHaveLength(4)
    expect(cards[0]!.text()).toContain('旅途总览')
    expect(cards[0]!.text()).toContain('342')
    expect(cards[1]!.text()).toContain('雷电将军')
    expect(cards[1]!.text()).toContain('UP')
    expect(cards[2]!.text()).toContain('1')
    expect(cards[3]!.text()).toContain('60 抽内必中 UP')
    expect(cards[3]!.text()).toContain('角色活动祈愿')
    expect(cards[3]!.classes()).toContain('ready')
  })

  it('状态栏:全本地徽章 + 记录数(含 novice)/覆盖起点/最近同步', () => {
    const { wrapper } = mountBoard()
    expect(wrapper.find('.local-badge').text()).toBe('全本地统计 · 除官方祈愿接口外零出网')
    expect(wrapper.find('.status-bar').text()).toContain('345 条记录')
    expect(wrapper.find('.status-bar').text()).toContain('覆盖 2026-01')
    expect(wrapper.find('.status-bar').text()).toContain('最近同步 2026-10-02 21:30')
  })
})

describe('BoardView · 名册切换与流水抽屉', () => {
  it('名册视图:按物品分组卡片 + 汇总芯片 + 尾注,可切回时间线', async () => {
    const { wrapper, board } = mountBoard()
    await wrapper.findAll('.view-switch button').find((button) => button.text() === '名册')!.trigger('click')
    expect(board.listView).toBe('roster')
    const cards = wrapper.findAll('.roster-card')
    expect(cards).toHaveLength(5)
    const chips = wrapper.find('.rh-chips').text()
    expect(chips).toContain('UP 2')
    expect(chips).toContain('歪 3')
    expect(chips).toContain('超欧 1')
    expect(chips).toContain('超非 2')
    // 不完整获取的拉数显「—」(刻晴卡为最新获取序最末);尾注为 domain 常量
    const lastCard = cards[cards.length - 1]!
    expect(lastCard.find('.card-name').text()).toContain('刻晴')
    expect(lastCard.find('.ci-q').text()).toBe('— 抽')
    expect(wrapper.find('.roster-foot').text()).toContain('活动赠送')
    await wrapper.findAll('.view-switch button').find((button) => button.text() === '时间线')!.trigger('click')
    expect(wrapper.find('.timeline').exists()).toBe(true)
  })

  it('流水抽屉:完整流水入口打开,仅五星/301-400 筛选与分页可用', async () => {
    const { wrapper, board } = mountBoard()
    expect(wrapper.find('.ledger').exists()).toBe(false)
    await wrapper.find('.ledger-link').trigger('click')
    expect(board.ledgerOpen).toBe(true)
    expect(wrapper.findAll('.ledger-body .ledger-tr')).toHaveLength(200)
    // 仅五星:9 条
    await wrapper.find('.ledger-switch input').setValue(true)
    expect(wrapper.findAll('.ledger-body .ledger-tr')).toHaveLength(9)
    // 关掉五星开关后再验 301/400 二级筛选(两筛选叠加):400 → 7 条
    await wrapper.find('.ledger-switch input').setValue(false)
    await wrapper.findAll('.code-btn').find((button) => button.text() === '400')!.trigger('click')
    expect(wrapper.findAll('.ledger-body .ledger-tr')).toHaveLength(7)
    expect(wrapper.find('.ledger-count').text()).toContain('共 7 条')
    await wrapper.findAll('.code-btn').find((button) => button.text() === '全部')!.trigger('click')
    expect(wrapper.find('.ledger-count').text()).toContain('共 345 条')
    // 分页
    await wrapper.findAll('.page-btn').find((button) => button.text() === '下一页')!.trigger('click')
    expect(wrapper.find('.page-info').text()).toBe('第 2 / 2 页')
  })

  it('Ctrl/⌘+L 呼出、Esc 收起流水抽屉(DESIGN §10)', async () => {
    const { wrapper } = mountBoard()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true }))
    await nextTick()
    expect(wrapper.find('.ledger').exists()).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(wrapper.find('.ledger').exists()).toBe(false)
  })

  it('新手祈愿页签:保底仪整带隐藏(pity null),时间线仍出;未收录页签走兜底列表', async () => {
    const { wrapper } = mountBoard()
    await tabByText(wrapper, '新手祈愿').trigger('click')
    expect(wrapper.find('.pity-band').exists()).toBe(false)
    expect(wrapper.findAll('.wish-row')).toHaveLength(1)
    await tabByText(wrapper, '未收录').trigger('click')
    expect(wrapper.find('.unknown-list').exists()).toBe(true)
    expect(wrapper.text()).toContain('未收录祈愿 1000')
  })
})

describe('BoardView · T17 返工(rosterStale 提示行 / 保底仪空态与缺口提示)', () => {
  /** 分钟步进时间串(自 2026-05-01 10:01 起,升序) */
  function fillerTime(index: number): string {
    const m = 601 + index
    return `2026-05-01 ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`
  }

  it('rosterStale 提示行:常驻池出现名单外五星时显示,限定 UP 不触发(池级收窄口径)', () => {
    // 常驻池名单外五星 → 池级旗标;eventChar 限定 UP(雷电将军)不触发
    const stale = mountWith([
      storedRecord({ gachaType: 200, name: '虚构的新常驻', rankType: 5, time: '2026-05-01 10:00:00' }),
      storedRecord({ gachaType: 301, name: '雷电将军', rankType: 5, time: '2026-05-01 11:00:00' }),
    ])
    expect(stale.wrapper.find('.vp-stale').exists()).toBe(true)
    expect(stale.wrapper.find('.vp-stale').text()).toContain('检测到常驻池出现名单外五星')
    expect(stale.wrapper.find('.vp-stale').text()).toContain('请更新应用')
    stale.wrapper.unmount()

    // 仅限定 UP(名单查无)→ 条目级 stale,池级旗标不置 → 提示行不出现
    const clean = mountWith([
      storedRecord({ gachaType: 301, name: '雷电将军', rankType: 5, time: '2026-05-01 10:00:00' }),
    ])
    expect(clean.wrapper.find('.vp-stale').exists()).toBe(false)
  })

  it('保底仪空态:作用域 totalPulls===0 显空态文案,不渲染 0/90 刻度(返工 #2)', async () => {
    const { wrapper } = mountBoard()
    await tabByText(wrapper, '集录祈愿').trigger('click')
    expect(wrapper.find('.pity-band').exists()).toBe(true)
    expect(wrapper.find('.pity-empty').text()).toContain('该池暂无祈愿记录')
    expect(wrapper.find('.pity-scale').exists()).toBe(false)
    expect(wrapper.find('.pity-val').exists()).toBe(false)
  })

  it('距软/距硬为负照实显示并带「数据存在缺口」title,不钳制(返工 #3)', () => {
    const records = [
      storedRecord({ gachaType: 301, name: '刻晴', rankType: 5, time: '2026-05-01 10:00:00' }),
      ...Array.from(
        { length: 91 },
        (_, i) => storedRecord({ gachaType: 301, name: `杂记${i}`, rankType: 3, time: fillerTime(i) }),
      ),
    ]
    const { wrapper } = mountWith(records)
    const reads = wrapper.findAll('.read')
    expect(reads[0]!.find('.v').text()).toContain('-17') // 74 − 91,照实显示
    expect(reads[0]!.find('.v').attributes('title')).toBe('数据存在缺口')
    expect(reads[1]!.find('.v').text()).toContain('-1') // 90 − 91
    expect(reads[1]!.find('.v').attributes('title')).toBe('数据存在缺口')
    // 数值不被钳制:大数字仍为 91
    expect(wrapper.find('.pity-val').text()).toBe('91')
  })
})
