<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import HighlightsGrid from './HighlightsGrid.vue'
import LedgerDrawer from './LedgerDrawer.vue'
import PityBand from './PityBand.vue'
import PoolTabs from './PoolTabs.vue'
import RosterView from './RosterView.vue'
import StatusBar from './StatusBar.vue'
import UnknownList from './UnknownList.vue'
import VerdictPanel from './VerdictPanel.vue'
import WishTimeline from './WishTimeline.vue'
import type { PoolCategory } from '@/domain/pools'
import { useBoardStore } from '@/stores/board'

/**
 * 主统计画面(V5「璇玑」主版面,DESIGN §3 自上而下):
 * 池页签栏 → 保底仪(通栏,页签正下方)→ 两栏(左:祈愿时间线/名册切换;
 * 右:欧非总账 = 评语区 + 高光时刻 2×2)→ 状态栏;流水抽屉底部滑出。
 * 全部内容由 board store 的 domain 视图模型驱动;窄窗经容器查询(≤1150px)单列降级。
 */
const board = useBoardStore()

/** 时间线头部的超欧/超非计数(原 WishTimeline 头部行,并入工具行右缘) */
const degreeCounts = computed(() => {
  const counts = { superLucky: 0, unlucky: 0 }
  for (const row of board.timelineRows) {
    if (row.degree === 'superLucky') counts.superLucky += 1
    if (row.degree === 'unlucky') counts.unlucky += 1
  }
  return counts
})

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    if (board.ledgerOpen) board.toggleLedger(false)
    return
  }
  // Ctrl/⌘+L 呼出/收起流水(DESIGN §10)
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
    event.preventDefault()
    board.toggleLedger()
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function onSelectScope(scope: PoolCategory): void {
  board.selectScope(scope)
}
</script>

<template>
  <div class="board">
    <PoolTabs
      :tabs="board.tabs"
      :counts="board.tabCounts"
      :active="board.scope"
      @select="onSelectScope"
    />
    <PityBand :stats="board.stats" />
    <div class="board-body">
      <div class="board-left">
        <div class="left-toolbar">
          <h2 class="left-title">
            {{ board.listView === 'timeline' ? '祈愿时间线' : '五星名册' }}
          </h2>
          <div
            class="view-switch"
            role="group"
            aria-label="左栏视图切换"
          >
            <button
              type="button"
              :class="{ on: board.listView === 'timeline' }"
              @click="board.setListView('timeline')"
            >
              时间线
            </button>
            <button
              type="button"
              :class="{ on: board.listView === 'roster' }"
              @click="board.setListView('roster')"
            >
              名册
            </button>
          </div>
          <div
            v-if="board.listView === 'timeline' && board.scope !== 'unknown'"
            class="th-badges"
          >
            <i class="count-badge deg-super-lucky">超欧 {{ degreeCounts.superLucky }}</i>
            <i class="count-badge deg-unlucky">超非 {{ degreeCounts.unlucky }}</i>
          </div>
        </div>
        <WishTimeline
          v-if="board.listView === 'timeline' && board.scope !== 'unknown'"
          :rows="board.timelineRows"
          :scope="board.scope"
          :meter-hard="board.meterScale.hard"
          :meter-bounds="board.meterScale.bounds"
          @open-ledger="board.toggleLedger(true)"
        />
        <RosterView
          v-else-if="board.listView === 'roster' && board.scope !== 'unknown'"
          :roster="board.roster"
          :scope="board.scope"
        />
        <UnknownList
          v-else
          :view="board.unknownView"
        />
      </div>
      <aside class="board-right">
        <VerdictPanel
          :stats="board.stats"
          :verdict="board.verdict"
        />
        <HighlightsGrid :highlights="board.highlights" />
      </aside>
    </div>
    <StatusBar
      :status="board.status"
      :last-synced-at="board.lastSyncedAt"
    />
    <LedgerDrawer @close="board.toggleLedger(false)" />
  </div>
</template>

<style scoped>
.board {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  container-type: inline-size;
  container-name: board;
}

.board-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.board-left {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.history-start {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 26px 0;
  color: var(--mut);
  font-size: 12px;
  cursor: pointer;
}

.history-start input {
  accent-color: var(--accent);
}

.left-toolbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 26px 0;
}

.left-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.view-switch {
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}

.view-switch button {
  border: none;
  background: none;
  padding: 5px 14px;
  font-size: 12px;
  letter-spacing: 0.06em;
  color: var(--mut);
  cursor: pointer;
}

.view-switch button + button {
  border-left: 1px solid var(--line);
}

.view-switch button.on {
  color: var(--accent);
  background: var(--accent-wash);
  font-weight: 600;
}

/* 时间线的超欧/超非计数(与名册头部芯片同 token 洗色) */
.th-badges {
  margin-left: auto;
  display: inline-flex;
  gap: 8px;
}

.count-badge {
  font-style: normal;
  font-size: 11.5px;
  letter-spacing: 0.06em;
}

.count-badge.deg-super-lucky {
  color: var(--zone-super-lucky);
}

.count-badge.deg-unlucky {
  color: var(--zone-unlucky);
}

.board-right {
  width: 344px;
  flex: none;
  border-left: 1px solid var(--line);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  /* 尺寸容器:高度由外层 flex 定死,供评语区 cqh 伸缩(窄窗降级改 inline-size) */
  container-type: size;
}

/* 窄窗单列降级(DESIGN §10:容器查询,非视口断点) */
@container board (max-width: 1150px) {
  .board-body {
    flex-direction: column;
    overflow-y: auto;
  }

  .board-left {
    overflow: visible;
  }

  .board-right {
    width: auto;
    border-left: none;
    border-top: 1px solid var(--line);
    overflow: visible;
    /* 高度回归内容驱动,size 容器会让高度塌陷,降级为 inline-size */
    container-type: inline-size;
  }
}
</style>
