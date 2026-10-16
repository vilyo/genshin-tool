<script setup lang="ts">
import { computed } from 'vue'
import { guaranteedReadyText, type HighlightsView } from '@/domain/highlights'
import { avatarFor } from './boardDisplay'

/**
 * 高光时刻 2×2(spec 04 §6):旅途总览 / 出手如电 / 漫长等待 / 大保底就绪。
 * 数据全部来自 buildHighlights 产物;大保底就绪 null 时显空态文案。
 * 出手如电卡带头像章(ADR-0005 内置图标菱形镶嵌,未知名回退首字占位章)。
 */
const props = defineProps<{ highlights: HighlightsView }>()

/** 最快五星的头像解析(无完整五星时 null,与 fastest 同步) */
const fastestAvatar = computed(() => {
  const fastest = props.highlights.fastest
  return fastest === null ? null : avatarFor(fastest.name)
})
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
          <span
            class="hl-seal"
            aria-hidden="true"
          >
            <img
              v-if="fastestAvatar?.kind === 'icon'"
              class="seal-img"
              :src="fastestAvatar?.url"
              alt=""
            >
            <span v-else>{{ fastestAvatar?.char }}</span>
          </span>{{ highlights.fastest.name }} · {{ highlights.fastest.date }} · {{ highlights.fastest.pool }}<template v-if="highlights.fastest.outcome !== null"> · {{ highlights.fastest.outcome }}</template>
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

/* 出手如电头像章(V5 菱章语法缩小版,单描边) */
.hl-seal {
  position: relative;
  display: inline-block;
  width: 20px;
  height: 20px;
  margin-right: 8px;
  vertical-align: -6px;
}

.hl-seal::before {
  content: '';
  position: absolute;
  inset: 0;
  border: 1px solid var(--accent-deep);
  border-radius: 3px;
  transform: rotate(45deg);
  background: var(--seal-bg);
}

/* 占位形态:首字居中(与时间线/名册章同款,字号随 20px 章缩小) */
.hl-seal > span {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 500;
  color: var(--accent);
}

/* 图标形态(ADR-0005):立像按菱形裁切镶嵌在描边之内,底色/描边沿用 */
.hl-seal .seal-img {
  position: absolute;
  inset: 3px;
  object-fit: cover;
  clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
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
