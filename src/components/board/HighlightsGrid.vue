<script setup lang="ts">
import { computed } from 'vue'
import type { HighlightsView } from '@/domain/highlights'
import { avatarFor } from './boardDisplay'

/**
 * 高光时刻(右栏 · 欧非总账下部,2026-10-17 一屏化精简):
 * 出手如电主卡(ADR-0005 头像章——内置图标整像圆环呈现、未知名回退菱形首字段)
 * + 旅途一行带(总抽数/五星数/覆盖天数/触底次数)。
 * 原四卡中的旅途总览/漫长等待并入一行带;大保底就绪与保底仪状态章重复,不再出卡
 * (highlights.guaranteed 字段保留在视图模型,UI 不消费)。数据全部来自 buildHighlights
 * 产物,fastest 为 null(四作用域均无完整五星)时主卡显空态文案。
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
        出手如电
      </div>
      <template v-if="highlights.fastest !== null">
        <div class="hl-main">
          <span
            class="hl-seal"
            :class="{ icon: fastestAvatar?.kind === 'icon' }"
            aria-hidden="true"
          >
            <img
              v-if="fastestAvatar?.kind === 'icon'"
              class="seal-img"
              :src="fastestAvatar?.url"
              alt=""
            >
            <span v-else>{{ fastestAvatar?.char }}</span>
          </span>
          <span class="hl-name">{{ highlights.fastest.name }}</span>
          <span class="hl-pulls">{{ highlights.fastest.pulls }}<small>抽</small></span>
        </div>
        <div class="hl-sub">
          {{ highlights.fastest.date }} · {{ highlights.fastest.pool }}<template v-if="highlights.fastest.outcome !== null"> · {{ highlights.fastest.outcome }}</template>
        </div>
      </template>
      <div
        v-else
        class="hl-empty"
      >
        暂无完整五星出货
      </div>
    </div>
    <p class="hl-journey">
      旅途 {{ highlights.journey.totalPulls }} 抽 · 五星 {{ highlights.journey.fiveStars }} · 覆盖 {{ highlights.journey.days }} 天 · 触底 {{ highlights.touchBottoms }} 次
    </p>
  </section>
</template>

<style scoped>
.highlights {
  flex: none;
  padding: 9px 24px 11px;
}

.hl-card {
  border: 1px solid var(--line-soft);
  border-radius: 10px;
  background: var(--seal-bg);
  padding: 9px 14px 10px;
}

.hl-k {
  font-size: 11.5px;
  color: var(--mut);
  letter-spacing: 0.1em;
}

.hl-main {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 出手如电头像章(占位为菱形、图标为环;img 显定宽高,替换元素 inset 不缩放) */
.hl-seal {
  position: relative;
  width: 26px;
  height: 26px;
  flex: none;
}

.hl-seal::before {
  content: '';
  position: absolute;
  inset: 0;
  border: 1.2px solid var(--accent-deep);
  border-radius: 4px;
  transform: rotate(45deg);
  background: var(--seal-bg);
}

.hl-seal.icon::before {
  transform: none;
  border-radius: 50%;
}

.hl-seal > span {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 500;
  color: var(--accent);
}

.hl-seal .seal-img {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 21px;
  height: 21px;
  transform: translate(-50%, -50%);
  object-fit: contain;
}

.hl-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--accent);
  letter-spacing: 0.05em;
}

.hl-pulls {
  margin-left: auto;
  font-family: var(--font-num);
  font-size: 26px;
  line-height: 1;
  color: var(--fg);
}

.hl-pulls small {
  font-family: var(--font-cjk);
  font-size: 11px;
  color: var(--dim);
  margin-left: 4px;
}

.hl-sub {
  margin-top: 4px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--dim);
  letter-spacing: 0.03em;
}

.hl-empty {
  margin-top: 10px;
  font-size: 11.5px;
  color: var(--dim);
  letter-spacing: 0.05em;
}

/* 旅途一行带:收编原旅途总览/漫长等待两卡(全局口径,mono 小字) */
.hl-journey {
  margin: 7px 0 0;
  padding-top: 6px;
  border-top: 1px solid var(--line-soft);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--dim);
  letter-spacing: 0.04em;
}
</style>
