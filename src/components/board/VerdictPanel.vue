<script setup lang="ts">
import { computed } from 'vue'
import type { PoolStats } from '@/domain/stats'
import {
  degreeOf,
  EVENT_CHAR_EXPECTED,
  EVENT_WEAPON_EXPECTED,
  GUARANTEED_BADGE,
  ROSTER_STALE_HINT,
  type Degree,
  type VerdictView,
} from '@/domain/verdict'
import { DEGREE_META, percentText } from './boardDisplay'

/**
 * 评语区 VerdictPanel(右栏 · 欧非总账上部):评级星盘(conic-gradient 刻度环 +
 * Italiana 评级字母,jsdom 无 canvas 故纯 CSS)+ 评级/评语行 + 口径行(期望参考线
 * 62.5/53.25 旁注口径)+ 档位印签四枚(fives 完整五星按 degreeOf 计数)+ 修正/彩蛋/
 * 大保底就绪徽章 + 名单过期提示行(池级旗标收窄为常驻池名单外五星,T17 返工)+
 * 捕获明光固定脚注(仅 eventChar)+ 指标瓦片。
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

/** 档位印签四枚:完整五星按 degreeOf 计数(不完整五星的 pulls 是占位下界,不参与) */
const stamps = computed<Record<Degree, number>>(() => {
  const counts: Record<Degree, number> = { superLucky: 0, lucky: 0, normal: 0, unlucky: 0 }
  for (const five of props.stats.fives) {
    if (five.incomplete) continue
    counts[degreeOf(five.pulls, props.stats.scope)] += 1
  }
  return counts
})

const DEGREES: Degree[] = ['superLucky', 'lucky', 'normal', 'unlucky']

function averageText(value: number | null): string {
  return value === null ? '—' : String(Number(value.toFixed(1)))
}

/** 评级行:评级字母 + 评语;不评级作用域仅「—」(spec §5) */
const verdictLine = computed(() =>
  props.verdict.comment === null
    ? `评级 ${dialLetter.value}`
    : `评级 ${dialLetter.value} · ${props.verdict.comment}`,
)

/** 口径行:平均出货(/出 UP 仅 eventChar)/期望参考线(旁注口径来源) */
const caliberLine = computed(() => {
  const parts = [`平均出货 ${averageText(props.verdict.avgPulls)}`]
  if (props.stats.scope === 'eventChar') {
    parts.push(`出 UP ${averageText(props.stats.avgUpPulls)}`)
  }
  if (expected.value !== null) {
    parts.push(`期望参考 ${expected.value.value}(${expected.value.note})`)
  }
  return parts.join(' · ')
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

    <!-- 评级星盘:外环 + conic-gradient 刻度带 + 北斗星位 + Italiana 评级字母 -->
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
      <div class="v2">
        {{ caliberLine }}
      </div>
    </div>

    <div class="stamps">
      <span
        v-for="degree in DEGREES"
        :key="degree"
        class="stamp"
        :class="DEGREE_META[degree].cls"
      ><i
        class="d"
        aria-hidden="true"
      />{{ DEGREE_META[degree].label }} ×{{ stamps[degree] }}</span>
    </div>

    <div
      v-if="
        verdict.correction !== null ||
          verdict.easterEgg !== null ||
          verdict.guaranteed
      "
      class="vp-badges"
    >
      <span
        v-if="verdict.correction !== null"
        class="vp-badge warn"
      >{{ verdict.correction }}</span>
      <span
        v-if="verdict.easterEgg !== null"
        class="vp-badge egg"
      >出手如电 · {{ verdict.easterEgg.name }} {{ verdict.easterEgg.pulls }} 抽({{ verdict.easterEgg.date }})</span>
      <span
        v-if="verdict.guaranteed"
        class="vp-badge jade"
      >{{ GUARANTEED_BADGE }}</span>
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

    <p
      v-if="stats.scope === 'eventChar'"
      class="vp-footnote"
    >
      {{ verdict.footnote }}
    </p>

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
  flex: none;
  padding: 0 24px;
}

.vp-head {
  height: 52px;
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

/* —— 评级星盘(纯 CSS:环形 + conic-gradient 刻度 + 星位 + 字母)—— */
.dial {
  position: relative;
  width: 172px;
  height: 172px;
  margin: 26px auto 0;
  border-radius: 50%;
  border: 1px solid var(--line);
}

.dial-ticks {
  position: absolute;
  inset: 5px;
  border-radius: 50%;
  background: repeating-conic-gradient(var(--accent-2) 0deg 0.8deg, transparent 0.8deg 5deg);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 11px), #000 calc(100% - 10px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 11px), #000 calc(100% - 10px));
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
  font-size: 64px;
  color: var(--accent);
}

.verdict-line {
  text-align: center;
  margin-top: 18px;
}

.v1 {
  font-size: 15.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
}

.v2 {
  margin-top: 8px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--mut);
  letter-spacing: 0.03em;
}

/* —— 档位印签 —— */
.stamps {
  margin-top: 16px;
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
}

.stamp {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 28px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  border: 1px solid var(--st-bd);
  background: var(--st-bg);
}

.stamp .d {
  width: 6px;
  height: 6px;
  transform: rotate(45deg);
  background: currentColor;
}

.stamp.deg-super-lucky {
  color: var(--zone-super-lucky);
  --st-bd: var(--rare-edge-super-lucky);
  --st-bg: var(--rare-bg-super-lucky);
}

.stamp.deg-lucky {
  color: var(--zone-lucky);
  --st-bd: var(--seal-inner);
  --st-bg: var(--seal-bg);
}

.stamp.deg-normal {
  color: var(--zone-normal);
  --st-bd: var(--line);
  --st-bg: var(--meter-seg-2);
}

.stamp.deg-unlucky {
  color: var(--zone-unlucky);
  --st-bd: var(--rare-edge-unlucky);
  --st-bg: var(--rare-bg-unlucky);
}

/* —— 修正/彩蛋/就绪/名单过期徽章 —— */
.vp-badges {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.vp-badge {
  font-size: 11.5px;
  letter-spacing: 0.05em;
  border-radius: 7px;
  padding: 5px 10px;
  text-align: center;
}

.vp-badge.warn {
  color: var(--cinnabar);
  border: 1px solid var(--cinnabar);
  background: transparent;
}

.vp-badge.egg {
  color: var(--spring);
  border: 1px solid var(--line);
  background: var(--seal-bg);
}

.vp-badge.jade {
  color: var(--jade);
  border: 1px solid var(--jade-bd);
  background: var(--jade-bg);
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

.vp-footnote {
  margin: 10px 0 0;
  text-align: center;
  font-size: 10.5px;
  color: var(--dim);
  letter-spacing: 0.04em;
}

/* —— 指标瓦片 2×2 —— */
.vp-tiles {
  margin-top: 16px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-top: 1px solid var(--line);
}

.tile {
  padding: 12px 4px 10px 2px;
  border-bottom: 1px solid var(--line);
}

.tile:nth-child(odd) {
  border-right: 1px solid var(--line);
  padding-left: 0;
}

.tile:nth-child(even) {
  padding-left: 18px;
}

.tile-k {
  font-size: 11.5px;
  color: var(--mut);
  letter-spacing: 0.1em;
}

.tile-v {
  margin-top: 5px;
  font-family: var(--font-num);
  font-size: 30px;
  line-height: 1;
  color: var(--fg);
}

.tile-v small {
  font-family: var(--font-cjk);
  font-size: 11px;
  color: var(--dim);
  margin-left: 6px;
}
</style>
