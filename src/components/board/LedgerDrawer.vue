<script setup lang="ts">
import { computed } from 'vue'
import { poolLabel } from '@/domain/pools'
import { LEDGER_PAGE_SIZE, useBoardStore } from '@/stores/board'

/**
 * 流水抽屉(底部滑出,DESIGN §3.4):档案全部记录倒序表(时间/池名/名称/星级,
 * 明细保留原始 gacha_type——池名列即 poolLabel(code));仅五星开关;eventChar 池内
 * 301/400 二级筛选(只影响明细展示,spec §2);CSS overflow + 每页 200 条分页按钮。
 */
const store = useBoardStore()

const emit = defineEmits<{ close: [] }>()

/** 二级筛选按钮(仅 eventChar 页签出现;选项 = 档案实有 code,合并明细保留原始 code) */
const codeOptions = computed(() => (store.scope === 'eventChar' ? store.stats.codes : []))
</script>

<template>
  <div
    v-if="store.ledgerOpen"
    class="ledger-layer"
  >
    <div
      class="ledger-backdrop"
      @click="emit('close')"
    />
    <section
      class="ledger"
      role="dialog"
      aria-label="祈愿流水"
    >
      <header class="ledger-head">
        <h2 class="ledger-title">
          祈愿流水
        </h2>
        <label class="ledger-switch">
          <input
            type="checkbox"
            :checked="store.ledgerFiveOnly"
            @change="store.setLedgerFiveOnly(($event.target as HTMLInputElement).checked)"
          >
          仅五星
        </label>
        <div
          v-if="codeOptions.length > 0"
          class="ledger-codes"
          role="group"
          aria-label="301/400 二级筛选"
        >
          <button
            type="button"
            class="code-btn"
            :class="{ on: store.ledgerCode === null }"
            @click="store.setLedgerCode(null)"
          >
            全部
          </button>
          <button
            v-for="code in codeOptions"
            :key="code"
            type="button"
            class="code-btn"
            :class="{ on: store.ledgerCode === code }"
            @click="store.setLedgerCode(code)"
          >
            {{ code }}
          </button>
        </div>
        <button
          type="button"
          class="ledger-close"
          @click="emit('close')"
        >
          关闭
        </button>
      </header>
      <div class="ledger-table">
        <div class="ledger-tr ledger-th">
          <span>时间</span>
          <span>池名</span>
          <span>名称</span>
          <span class="th-rank">星级</span>
        </div>
        <div class="ledger-body">
          <div
            v-for="(row, index) in store.ledgerPageRows"
            :key="`${row.time}-${row.name}-${row.gachaType}-${index}`"
            class="ledger-tr"
          >
            <span class="lt-time">{{ row.time }}</span>
            <span class="lt-pool">{{ poolLabel(row.gachaType) }}</span>
            <span class="lt-name">{{ row.name }}</span>
            <span
              class="lt-rank"
              :class="`rank-${row.rankType}`"
            >{{ '★'.repeat(row.rankType) }}</span>
          </div>
        </div>
      </div>
      <footer class="ledger-foot">
        <span class="ledger-count">共 {{ store.ledgerRows.length }} 条 · 每页 {{ LEDGER_PAGE_SIZE }} 条</span>
        <span class="ledger-pager">
          <button
            type="button"
            class="page-btn"
            :disabled="store.ledgerEffectivePage === 0"
            @click="store.prevLedgerPage()"
          >
            上一页
          </button>
          <span class="page-info">第 {{ store.ledgerEffectivePage + 1 }} / {{ store.ledgerPageCount }} 页</span>
          <button
            type="button"
            class="page-btn"
            :disabled="store.ledgerEffectivePage >= store.ledgerPageCount - 1"
            @click="store.nextLedgerPage()"
          >
            下一页
          </button>
        </span>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.ledger-layer {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.ledger-backdrop {
  flex: 1;
  background: var(--backdrop);
}

.ledger {
  flex: none;
  height: 56vh;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--raise-border);
  background: var(--raise);
  box-shadow: 0 -30px 70px -40px rgba(0, 0, 0, 0.7);
}

.ledger-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 10px 26px;
  border-bottom: 1px solid var(--line);
}

.ledger-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.ledger-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--mut);
  cursor: pointer;
}

.ledger-codes {
  display: inline-flex;
  gap: 6px;
}

.code-btn {
  border: 1px solid var(--line);
  background: none;
  border-radius: 7px;
  padding: 4px 12px;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--mut);
  cursor: pointer;
}

.code-btn.on {
  color: var(--accent);
  border-color: var(--accent-2);
  background: var(--accent-wash);
}

.ledger-close {
  margin-left: auto;
  border: 1px solid var(--line);
  background: none;
  border-radius: 8px;
  padding: 5px 14px;
  font-size: 12px;
  color: var(--mut);
  cursor: pointer;
}

.ledger-close:hover {
  color: var(--fg);
  border-color: var(--accent-2);
}

.ledger-table {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.ledger-tr {
  display: grid;
  grid-template-columns: 180px 1.2fr 1fr 80px;
  column-gap: 14px;
  align-items: center;
  padding: 0 26px;
  font-size: 12px;
}

.ledger-th {
  flex: none;
  height: 34px;
  border-bottom: 1px solid var(--line);
  color: var(--mut);
  letter-spacing: 0.08em;
  font-size: 11.5px;
}

.th-rank {
  text-align: right;
}

.ledger-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.ledger-body .ledger-tr {
  height: 30px;
  border-bottom: 1px solid var(--line-soft);
}

.lt-time {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--dim);
}

.lt-pool {
  color: var(--mut);
}

.lt-name {
  color: var(--fg);
}

.lt-rank {
  text-align: right;
  font-size: 11px;
  letter-spacing: 0.12em;
}

.lt-rank.rank-5 {
  color: var(--accent);
}

.lt-rank.rank-4 {
  color: var(--purple);
}

.lt-rank.rank-3 {
  color: var(--cyan);
}

.ledger-foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 9px 26px;
  border-top: 1px solid var(--line);
}

.ledger-count {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--dim);
}

.ledger-pager {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.page-btn {
  border: 1px solid var(--line);
  background: none;
  border-radius: 7px;
  padding: 4px 12px;
  font-size: 12px;
  color: var(--mut);
  cursor: pointer;
}

.page-btn:hover:not(:disabled) {
  color: var(--fg);
  border-color: var(--accent-2);
}

.page-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.page-info {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--dim);
}
</style>
