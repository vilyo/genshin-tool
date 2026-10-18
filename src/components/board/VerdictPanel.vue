<script setup lang="ts">
import { computed } from 'vue'
import type { PoolStats } from '@/domain/stats'
import {
  EVENT_CHAR_EXPECTED,
  EVENT_WEAPON_EXPECTED,
  ROSTER_STALE_HINT,
  type VerdictView,
} from '@/domain/verdict'
import { percentText } from './boardDisplay'

/**
 * 评语区 VerdictPanel(右栏 · 欧非总账上部,2026-10-17 一屏化精简):评级星盘
 * (conic-gradient 刻度环 + 评级字母,jsdom 无 canvas 故纯 CSS)+ 评级/评语行
 * + 口径行(期望参考线 62.5/53.25 旁注口径;明光说明降级为行 title 悬停)+
 * 歪率修正徽章 + 名单过期提示行(池级旗标收窄为常驻池名单外五星,T17 返工)+ 指标瓦片。
 * 档位印签/彩蛋徽章/大保底徽章已删——档位分布由时间线头部徽章与量距条档色编码,
 * 彩蛋与就绪态由高光主卡/保底仪状态章承载,右栏不重复。
 * 全部输入为 computePoolStats/applyVerdict 产物,组件零口径。
 */
const props = defineProps<{
  stats: PoolStats
  verdict: VerdictView
}>()

/** 星盘字母 = applyVerdict 的显示评级(含 + 修正后字母);不评级显示「—」 */
const dialLetter = computed(() => props.verdict.displayRating ?? '—')

/** 口径行的期望参考线(spec §5:常驻/集录按角色类 62.5,新手仅有平均出货时,unknown 无) */
const expected = computed<{ value: number; note: string } | null>(() => {
  switch (props.stats.scope) {
    case 'eventWeapon':
      return { value: EVENT_WEAPON_EXPECTED, note: '社区口径' }
    case 'unknown':
      return null
    case 'novice':
      return props.stats.avgPulls !== null
        ? { value: EVENT_CHAR_EXPECTED, note: '官方综合概率倒数' }
        : null
    default:
      return { value: EVENT_CHAR_EXPECTED, note: '官方综合概率倒数' }
  }
})

function averageText(value: number | null): string {
  return value === null ? '—' : String(Number(value.toFixed(1)))
}

/** 评级行:评级字母 + 评语;不评级作用域仅「—」(spec §5) */
const verdictLine = computed(() =>
  props.verdict.comment === null
    ? `评级 ${dialLetter.value}`
    : `评级 ${dialLetter.value} · ${props.verdict.comment}`,
)

/** 口径行:平均出货/出 UP(仅 eventChar;期望参考线与明光说明入行 title 悬停) */
const caliberLine = computed(() => {
  const parts = [`平均出货 ${averageText(props.verdict.avgPulls)}`]
  if (props.stats.scope === 'eventChar') {
    parts.push(`出 UP ${averageText(props.stats.avgUpPulls)}`)
  }
  return parts.join(' · ')
})

/** 口径行悬停 title:期望参考线(含口径来源)+ 明光说明(仅 eventChar) */
const caliberTitle = computed(() => {
  const lines: string[] = []
  if (expected.value !== null) {
    lines.push(`期望参考 ${expected.value.value}(${expected.value.note})`)
  }
  if (props.stats.scope === 'eventChar') {
    lines.push(props.verdict.footnote)
  }
  return lines.length > 0 ? lines.join('\n') : undefined
})

/** 指标瓦片:总祈愿/五星/平均出货/歪率(歪率仅 eventChar 有值) */
const tiles = computed(() => [
  { k: '总祈愿', v: String(props.stats.totalPulls), unit: '抽' },
  { k: '五星', v: String(props.stats.fives.length), unit: '颗' },
  {
    k: '平均出货',
    v: props.stats.avgPulls === null ? '—' : String(Number(props.stats.avgPulls.toFixed(1))),
    unit: '抽',
  },
  {
    k: '歪率',
    v: props.stats.offRate === null ? '—' : percentText(props.stats.offRate).replace('%', ''),
    unit: '%',
  },
])
</script>

<template>
  <section
    class="verdict-panel"
    aria-label="欧非总账"
  >
    <header class="vp-head">
      <span class="vp-title">欧非总账</span>
      <span class="vp-en">VERDICT</span>
    </header>

    <!-- 评级簇(垂直弹性区):窗口变高时星盘随之放大(104→176 上限)并整体居中,
         多余高度被此区吸收,指标瓦片与高光锚在栏底,不出现底部大片留白 -->
    <div class="vp-center">
      <!-- 评级星盘:外环 + conic-gradient 刻度带 + 北斗星位 + 评级字母 -->
      <div
        class="dial"
        role="img"
        :aria-label="`评级 ${dialLetter}`"
      >
        <i
          class="dial-ticks"
          aria-hidden="true"
        />
        <i
          v-for="index in 7"
          :key="`star-${index}`"
          class="dial-star"
          :style="{ left: `${[63, 74, 69, 58, 45, 32, 16][index - 1]}%`, top: `${[18, 30, 47, 54, 55, 59, 65][index - 1]}%` }"
        />
        <span class="dial-letter">{{ dialLetter }}</span>
      </div>

      <div class="verdict-line">
        <div class="v1">
          {{ verdictLine }}
        </div>
        <div
          class="v2"
          :title="caliberTitle"
        >
          {{ caliberLine }}
        </div>
      </div>

      <div
        v-if="verdict.correction !== null"
        class="vp-badges"
      >
        <span class="vp-badge warn">{{ verdict.correction }}</span>
      </div>

      <!-- 名单过期提示(T17 返工:池级旗标已收窄为常驻池名单外五星,触发即有实义;降为提示行不占徽章位) -->
      <p
        v-if="verdict.rosterStale"
        class="vp-stale"
      >
        <span
          class="mark"
          aria-hidden="true"
        >◆</span>检测到常驻池出现名单外五星,{{ ROSTER_STALE_HINT }}
      </p>
    </div>

    <div class="vp-tiles">
      <div
        v-for="tile in tiles"
        :key="tile.k"
        class="tile"
      >
        <div class="tile-k">
          {{ tile.k }}
        </div>
        <div class="tile-v">
          {{ tile.v }}<small>{{ tile.unit }}</small>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.verdict-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0 24px;
}

.vp-head {
  height: 40px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--line);
}

.vp-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.vp-en {
  margin-left: auto;
  font-family: var(--font-tech);
  font-weight: 300;
  font-size: 11px;
  letter-spacing: 0.26em;
  color: var(--dim);
}

/* —— 评级簇(弹性区):吸收右栏多余高度,星盘随之放大并整体垂直居中 —— */
.vp-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

/* —— 评级星盘(纯 CSS:环形 + conic-gradient 刻度 + 星位 + 字母);
   宽高同 clamp 随右栏容器高伸缩(22cqh;纵 flex 里 width:auto 会被拉伸,禁用) —— */
.dial {
  position: relative;
  width: clamp(104px, 22cqh, 176px);
  height: clamp(104px, 22cqh, 176px);
  margin: 0 auto;
  border-radius: 50%;
  border: 1px solid var(--line);
}

.dial-ticks {
  position: absolute;
  inset: 4px;
  border-radius: 50%;
  background: repeating-conic-gradient(var(--accent-2) 0deg 0.8deg, transparent 0.8deg 5deg);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 7px), #000 calc(100% - 6px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 7px), #000 calc(100% - 6px));
  opacity: 0.4;
}

.dial-star {
  position: absolute;
  width: 5px;
  height: 5px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 6px var(--accent-2);
  opacity: 0.85;
}

.dial-letter {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-num);
  font-size: clamp(44px, 9.5cqh, 64px);
  color: var(--accent);
}

.verdict-line {
  text-align: center;
  margin-top: 8px;
}

.v1 {
  font-size: 15.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
}

.v2 {
  margin-top: 4px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--mut);
  letter-spacing: 0.03em;
}

/* —— 歪率修正徽章(独有信息保留;彩蛋/就绪态由高光主卡与保底仪承载) —— */
.vp-badges {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.vp-badge {
  font-size: 11.5px;
  letter-spacing: 0.05em;
  border-radius: 7px;
  padding: 4px 10px;
  text-align: center;
}

.vp-badge.warn {
  color: var(--cinnabar);
  border: 1px solid var(--cinnabar);
  background: transparent;
}

/* 名单过期提示行(T17 返工:降为细字提示,保留可见性) */
.vp-stale {
  margin: 10px 0 0;
  text-align: center;
  font-size: 10.5px;
  line-height: 1.7;
  color: var(--mut);
  letter-spacing: 0.04em;
}

.vp-stale .mark {
  color: var(--cinnabar);
  margin-right: 4px;
}

/* —— 指标瓦片:单行四格(2026-10-17 一屏化,2×2 改横排) —— */
.vp-tiles {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border-top: 1px solid var(--line);
}

.tile {
  padding: 7px 4px 6px 8px;
  border-bottom: 1px solid var(--line);
}

.tile + .tile {
  border-left: 1px solid var(--line);
}

.tile-k {
  font-size: 10.5px;
  color: var(--mut);
  letter-spacing: 0.08em;
}

.tile-v {
  margin-top: 4px;
  font-family: var(--font-num);
  font-size: 22px;
  line-height: 1;
  color: var(--fg);
}

.tile-v small {
  font-family: var(--font-cjk);
  font-size: 10.5px;
  color: var(--dim);
  margin-left: 4px;
}

/* 窄窗单列降级:右栏不再是尺寸容器(cqh 失义),星盘钉回固定尺寸 */
@container board (max-width: 1150px) {
  .dial {
    width: 104px;
    height: 104px;
  }

  .dial-letter {
    font-size: 44px;
  }
}
</style>
