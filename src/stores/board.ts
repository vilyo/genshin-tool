import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  buildHighlights,
  buildStatusBar,
  buildUnknownView,
  type HighlightsView,
  type StatusBarView,
  type UnknownView,
} from '@/domain/highlights'
import { poolLabel } from '@/domain/pools'
import { CHAR_HARD_PITY, WEAPON_HARD_PITY, type PoolCategory } from '@/domain/pools'
import { POOL_TABS, visibleTabs, type PoolTab } from '@/domain/poolTabs'
import { compareRecords, type StoredRecord } from '@/domain/records'
import { buildRoster, type RosterView as RosterViewVM } from '@/domain/roster'
import { computePoolStats, type PoolStats } from '@/domain/stats'
import { applyVerdict, degreeOf, type VerdictView } from '@/domain/verdict'
import { buildTagIndex, meterBounds, timelineKey } from '@/components/board/boardDisplay'
import { useAppStore } from '@/stores/app'

/** 流水抽屉每页行数(T17:CSS overflow + 分页按钮,不引入虚拟滚动) */
export const LEDGER_PAGE_SIZE = 200

/** 左栏视图:时间线(V5 主体)/ 名册(补充视图) */
export type BoardListView = 'timeline' | 'roster'

/** 时间线单行视图模型(five + 程度档 + C/R 标注,新的在前) */
export interface TimelineRow {
  five: PoolStats['fives'][number]
  degree: ReturnType<typeof degreeOf>
  tag: string | null
}

/**
 * 主画面 store(T17):选中作用域、左栏视图与流水抽屉的交互状态 + domain 视图模型的
 * 统一出口。全部统计由 domain 纯函数产出(computePoolStats/buildRoster/buildHighlights/
 * applyVerdict/visibleTabs),computed 依赖 app.records 与选中作用域——记录集不变即缓存
 * 复用(spec 04 D8 档案级缓存),组件内不重复实现任何统计口径。
 */
export const useBoardStore = defineStore('board', () => {
  const app = useAppStore()

  // —— 交互状态 ——
  /** 选中池页签(默认角色活动) */
  const scope = ref<PoolCategory>('eventChar')
  const listView = ref<BoardListView>('timeline')
  const ledgerOpen = ref(false)
  const ledgerFiveOnly = ref(false)
  /** eventChar 池内 301/400 二级筛选(明细保留原始 code;null = 全部;只影响明细展示,spec §2) */
  const ledgerCode = ref<number | null>(null)
  const ledgerPage = ref(0)

  // —— 页签 ——
  const tabs = computed<PoolTab[]>(() => visibleTabs(app.records))
  /** 页签五星计数(POOL_TABS 六作用域恒有定义;每作用域一趟 O(n),记录集不变即复用) */
  const tabCounts = computed<Record<PoolCategory, number>>(() => {
    const counts = {} as Record<PoolCategory, number>
    for (const tab of POOL_TABS) {
      counts[tab.scope] = computePoolStats(tab.scope, app.records).fives.length
    }
    return counts
  })

  // —— 作用域视图模型(spec 04 §2–§5)——
  const stats = computed<PoolStats>(() => computePoolStats(scope.value, app.records))
  const verdict = computed<VerdictView>(() => applyVerdict(stats.value))
  const roster = computed<RosterViewVM>(() => buildRoster(scope.value, app.records))

  // —— 全局视图模型(spec 04 §6)——
  const highlights = computed<HighlightsView>(() => buildHighlights(app.records))
  const status = computed<StatusBarView>(() => buildStatusBar(app.records))
  const unknownView = computed<UnknownView>(() => buildUnknownView(app.records))

  /** 最近同步时间(当前档案元数据;null = 未同步) */
  const lastSyncedAt = computed<string | null>(
    () => app.archives.find((archive) => archive.uid === app.currentUid)?.lastSyncedAt ?? null,
  )

  /** 当前作用域页签(label 复用官方池名;六作用域恒有定义,与页签显隐无关) */
  const activeTab = computed<PoolTab>(
    () => POOL_TABS.find((tab) => tab.scope === scope.value)!,
  )

  /**
   * 时间线行(新的在前):五星序列 + 程度档(degreeOf 单一来源)+ C/R 标注——
   * 标注不重算跨池序,以名册视图(roster.ts 产物)按「名|日期|池|抽数」联查。
   */
  const timelineRows = computed<TimelineRow[]>(() => {
    const tagByKey = buildTagIndex(scope.value, roster.value)
    return [...stats.value.fives].reverse().map((five) => {
      const key = timelineKey(
        five.record.name,
        five.record.time.slice(0, 10),
        poolLabel(five.record.gachaType),
        five.pulls,
      )
      return { five, degree: degreeOf(five.pulls, scope.value), tag: tagByKey.get(key) ?? null }
    })
  })

  /**
   * 量距条标尺:归一化分母与档位界线百分比。有保底口径取 pity.hard(novice/unknown
   * 无保底带,按池常量兜底);界线经 degreeOf 反解(22/45/76、19/40/68 只在 verdict.ts
   * 维护一处),不在此重复定义。
   */
  const meterScale = computed<{ hard: number; bounds: [number, number, number] }>(() => ({
    hard: stats.value.pity?.hard ?? (scope.value === 'eventWeapon' ? WEAPON_HARD_PITY : CHAR_HARD_PITY),
    bounds: meterBounds(scope.value),
  }))

  // —— 流水抽屉(全部记录倒序;筛选只影响明细展示)——
  const ledgerRows = computed<StoredRecord[]>(() => {
    const rows = app.records.filter((record) => {
      if (ledgerFiveOnly.value && record.rankType !== 5) return false
      if (ledgerCode.value !== null && record.gachaType !== ledgerCode.value) return false
      return true
    })
    return [...rows].sort((a, b) => compareRecords(b, a)) // 倒序:新的在前
  })
  const ledgerPageCount = computed(() => Math.max(1, Math.ceil(ledgerRows.value.length / LEDGER_PAGE_SIZE)))
  /** 展示页(行数收缩时钳到末页;页游标本身不回写) */
  const ledgerEffectivePage = computed(() => Math.min(ledgerPage.value, ledgerPageCount.value - 1))
  const ledgerPageRows = computed<StoredRecord[]>(() => {
    const start = ledgerEffectivePage.value * LEDGER_PAGE_SIZE
    return ledgerRows.value.slice(start, start + LEDGER_PAGE_SIZE)
  })

  // —— 动作 ——
  function selectScope(next: PoolCategory): void {
    if (next === scope.value) return
    scope.value = next
    // 301/400 二级筛选仅 eventChar 池内有效,换页签即复位
    ledgerCode.value = null
  }

  function setListView(next: BoardListView): void {
    listView.value = next
  }

  function toggleLedger(open = !ledgerOpen.value): void {
    ledgerOpen.value = open
  }

  function setLedgerFiveOnly(value: boolean): void {
    ledgerFiveOnly.value = value
    ledgerPage.value = 0
  }

  function setLedgerCode(code: number | null): void {
    ledgerCode.value = code
    ledgerPage.value = 0
  }

  function nextLedgerPage(): void {
    ledgerPage.value = Math.min(ledgerPage.value + 1, ledgerPageCount.value - 1)
  }

  function prevLedgerPage(): void {
    ledgerPage.value = Math.max(ledgerPage.value - 1, 0)
  }

  return {
    scope,
    listView,
    ledgerOpen,
    ledgerFiveOnly,
    ledgerCode,
    tabs,
    tabCounts,
    activeTab,
    stats,
    verdict,
    roster,
    highlights,
    status,
    unknownView,
    lastSyncedAt,
    timelineRows,
    meterScale,
    ledgerRows,
    ledgerPageCount,
    ledgerEffectivePage,
    ledgerPageRows,
    selectScope,
    setListView,
    toggleLedger,
    setLedgerFiveOnly,
    setLedgerCode,
    nextLedgerPage,
    prevLedgerPage,
  }
})
