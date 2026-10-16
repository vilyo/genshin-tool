<script setup lang="ts">
import type { UnknownView } from '@/domain/highlights'

/**
 * 未收录作用域视图(spec 04 §6):仅总抽数/五星数与记录列表(原始 code 兜底池名),
 * 无任何比率与评价——不走时间线量距条,避免对未知 code 套用欧非口径。
 */
defineProps<{ view: UnknownView }>()
</script>

<template>
  <section
    class="unknown-list"
    aria-label="未收录祈愿"
  >
    <header class="unk-head">
      <span class="unk-sub">未知 gacha_type 兜底 · 不参与任何统计评价</span>
      <span class="unk-count">共 {{ view.totalPulls }} 抽 · 五星 {{ view.fiveStars }}</span>
    </header>
    <p
      v-if="view.records.length === 0"
      class="unk-empty"
    >
      暂无未收录记录
    </p>
    <ol class="unk-rows">
      <li
        v-for="(row, index) in view.records"
        :key="`${row.time}-${index}`"
        class="unk-row"
      >
        <span class="ur-time">{{ row.time }}</span>
        <span class="ur-pool">{{ row.pool }}</span>
        <span class="ur-name">{{ row.name }}</span>
        <span
          class="ur-rank"
          :class="`rank-${row.rankType}`"
        >{{ '★'.repeat(row.rankType) }}</span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.unknown-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.unk-head {
  display: flex;
  align-items: baseline;
  gap: 14px;
  padding: 14px 26px 10px;
}

.unk-sub {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--dim);
  letter-spacing: 0.06em;
}

.unk-count {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--mut);
}

.unk-empty {
  margin: 0;
  padding: 32px 26px;
  font-size: 12.5px;
  color: var(--dim);
}

.unk-rows {
  list-style: none;
  margin: 0;
  padding: 0;
}

.unk-row {
  display: grid;
  grid-template-columns: 170px 1fr minmax(120px, 200px) 70px;
  align-items: center;
  column-gap: 14px;
  padding: 8px 26px;
  border-bottom: 1px solid var(--line-soft);
  font-size: 12.5px;
}

.ur-time {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--dim);
}

.ur-pool {
  color: var(--mut);
}

.ur-name {
  text-align: right;
  color: var(--fg);
}

.ur-rank {
  text-align: right;
  font-size: 11px;
  letter-spacing: 0.12em;
}

.ur-rank.rank-5 {
  color: var(--accent);
}

.ur-rank.rank-4 {
  color: var(--purple);
}

.ur-rank.rank-3 {
  color: var(--cyan);
}
</style>
