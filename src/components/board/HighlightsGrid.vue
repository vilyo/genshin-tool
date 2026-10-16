<script setup lang="ts">
import { guaranteedReadyText, type HighlightsView } from '@/domain/highlights'

/**
 * 高光时刻 2×2(spec 04 §6):旅途总览 / 出手如电 / 漫长等待 / 大保底就绪。
 * 数据全部来自 buildHighlights 产物;大保底就绪 null 时显空态文案。
 */
defineProps<{ highlights: HighlightsView }>()
</script>

<template>
  <section
    class="highlights"
    aria-label="高光时刻"
  >
    <div class="hl-card">
      <div class="hl-k">
        旅途总览
      </div>
      <div class="hl-v">
        {{ highlights.journey.totalPulls }}<small>抽</small>
      </div>
      <div class="hl-s">
        五星 {{ highlights.journey.fiveStars }} 颗 · 覆盖 {{ highlights.journey.days }} 天<template v-if="highlights.journey.since !== null"> · 自 {{ highlights.journey.since }}</template>
      </div>
    </div>
    <div class="hl-card">
      <div class="hl-k">
        出手如电
      </div>
      <template v-if="highlights.fastest !== null">
        <div class="hl-v">
          {{ highlights.fastest.pulls }}<small>抽</small>
        </div>
        <div class="hl-s">
          {{ highlights.fastest.name }} · {{ highlights.fastest.date }} · {{ highlights.fastest.pool }}<template v-if="highlights.fastest.outcome !== null"> · {{ highlights.fastest.outcome }}</template>
        </div>
      </template>
      <div
        v-else
        class="hl-empty"
      >
        暂无完整五星出货
      </div>
    </div>
    <div class="hl-card">
      <div class="hl-k">
        漫长等待
      </div>
      <div class="hl-v">
        {{ highlights.touchBottoms }}<small>次触底</small>
      </div>
      <div class="hl-s">
        一单吃满硬保底的次数
      </div>
    </div>
    <div
      class="hl-card"
      :class="{ ready: highlights.guaranteed !== null }"
    >
      <div class="hl-k">
        大保底就绪
      </div>
      <template v-if="highlights.guaranteed !== null">
        <div class="hl-v">
          {{ highlights.guaranteed.current }}<small>抽垫</small>
        </div>
        <div class="hl-s">
          {{ highlights.guaranteed.pool }} · {{ guaranteedReadyText(highlights.guaranteed.remaining) }}
        </div>
      </template>
      <div
        v-else
        class="hl-empty"
      >
        当前未处于大保底就绪状态
      </div>
    </div>
  </section>
</template>

<style scoped>
.highlights {
  flex: none;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding: 16px 24px;
}

.hl-card {
  border: 1px solid var(--line-soft);
  border-radius: 10px;
  background: var(--seal-bg);
  padding: 12px 14px;
  min-height: 96px;
}

.hl-k {
  font-size: 11.5px;
  color: var(--mut);
  letter-spacing: 0.1em;
}

.hl-v {
  margin-top: 6px;
  font-family: var(--font-num);
  font-size: 34px;
  line-height: 1;
  color: var(--fg);
}

.hl-v small {
  font-family: var(--font-cjk);
  font-size: 11px;
  color: var(--dim);
  margin-left: 6px;
}

.hl-s {
  margin-top: 7px;
  font-size: 11px;
  line-height: 1.7;
  color: var(--dim);
  letter-spacing: 0.03em;
}

.hl-empty {
  margin-top: 14px;
  font-size: 11.5px;
  color: var(--dim);
  letter-spacing: 0.05em;
}

/* 大保底就绪出牌:翠玉洗色(V5 ready 语) */
.hl-card.ready {
  border-color: var(--jade-bd);
  background: var(--jade-bg);
}

.hl-card.ready .hl-v {
  color: var(--jade);
}

.hl-card.ready .hl-k,
.hl-card.ready .hl-s {
  color: var(--jade);
}
</style>
