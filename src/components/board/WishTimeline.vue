<script setup lang="ts">
import { computed } from 'vue'
import { poolLabel, type PoolCategory } from '@/domain/pools'
import { avatarFor, DEGREE_META } from './boardDisplay'
import type { TimelineRow } from '@/stores/board'

/**
 * 祈愿时间线(V5.1 量距条语法,左栏主列表):一行一次五星出货,新的在前。
 * 行 = 头像章(ADR-0005 内置图标按 V5 菱形镶嵌,未知名回退首字占位章)+ 物品名(C/R 标签随名)+ 日期与池名 + 量距条(条长 = pulls/硬保底
 * 归一化、条色 = degreeOf 四档、背景轨四段分段与界线刻度、菱形游标)+ 右侧结果区
 * (档位词/抽数/抽/歪章)——结果区按 grid 固定列模板对齐(档位词右缘、数字个位、
 * 单位、结果章四列垂直轨,DESIGN §3)。抽数与档色只来自 stats.fives × degreeOf。
 */
const props = defineProps<{
  rows: TimelineRow[]
  scope: PoolCategory
  /** 量距条归一化分母(硬保底 90/80,pity 缺省按池常量兜底,来自 board store) */
  meterHard: number
  /** 量距条档位界线(degreeOf 反解,来自 board store) */
  meterBounds: [number, number, number]
}>()

defineEmits<{ 'open-ledger': [] }>()

/** 行 + 头像解析一次算好(avatarFor:清单命中为内置图标,否则首字占位章) */
const decoratedRows = computed(() =>
  props.rows.map((row) => ({ row, avatar: avatarFor(row.five.record.name) })),
)

const countByDegree = computed(() => {
  const counts = { superLucky: 0, unlucky: 0 }
  for (const row of props.rows) {
    if (row.five.incomplete) continue
    if (row.degree === 'superLucky') counts.superLucky += 1
    if (row.degree === 'unlucky') counts.unlucky += 1
  }
  return counts
})

/** 超欧/超非 = 稀有行(独立洗色 token,双主题等权);不完整行不洗色(pulls 是占位下界) */
function rowClass(row: TimelineRow): string[] {
  const classes: string[] = []
  if (!row.five.incomplete && row.degree === 'superLucky') classes.push('rare', 'rare-super-lucky')
  if (!row.five.incomplete && row.degree === 'unlucky') classes.push('rare', 'rare-unlucky')
  return classes
}

function pct(pulls: number): string {
  return `${Math.min(100, (pulls / props.meterHard) * 100)}%`
}

/** 段宽:0–b1 / b1–b2 / b2–b3 / b3–hard,四档分段 */
function segStyle(index: number): { left: string; width: string } {
  const edges = [0, ...props.meterBounds, props.meterHard]
  const from = edges[index]!
  const to = edges[index + 1]!
  return { left: pct(from), width: `${((to - from) / props.meterHard) * 100}%` }
}

const minorTicks = computed(() => {
  const ticks: number[] = []
  for (let value = 10; value < props.meterHard; value += 10) ticks.push(value)
  return ticks
})

function meterLabel(row: TimelineRow): string {
  return `出货 ${row.five.incomplete ? '—' : row.five.pulls} 抽 · ${DEGREE_META[row.degree].label}`
}
</script>

<template>
  <section
    class="timeline"
    aria-label="祈愿时间线"
  >
    <header class="timeline-head">
      <span class="th-sub">按抽卡顺序 · 新的在前</span>
      <span class="th-note">量距条 · 条长 = 垫抽数 · 条色 = 欧非档</span>
      <span class="th-badges">
        <i class="count-badge deg-super-lucky">超欧 {{ countByDegree.superLucky }}</i>
        <i class="count-badge deg-unlucky">超非 {{ countByDegree.unlucky }}</i>
      </span>
    </header>
    <p
      v-if="rows.length === 0"
      class="timeline-empty"
    >
      该池暂无五星出货记录
    </p>
    <ol class="timeline-rows">
      <li
        v-for="({ row, avatar }, index) in decoratedRows"
        :key="`${row.five.record.time}-${row.five.record.name}-${index}`"
        class="wish-row"
        :class="rowClass(row)"
      >
        <span
          class="wish-seal"
          aria-hidden="true"
        >
          <img
            v-if="avatar.kind === 'icon'"
            class="seal-img"
            :src="avatar.url"
            alt=""
          >
          <span v-else>{{ avatar.char }}</span>
        </span>
        <div class="wish-name">
          <div class="nm1">
            {{ row.five.record.name }}<span
              v-if="row.tag !== null"
              class="nm-tag"
            >· {{ row.tag }}</span>
          </div>
          <div class="nm2">
            {{ row.five.record.time.slice(0, 16) }} · 池 {{ poolLabel(row.five.record.gachaType) }}
          </div>
        </div>
        <div
          class="meter"
          :class="{ incomplete: row.five.incomplete }"
          role="img"
          :aria-label="meterLabel(row)"
        >
          <i
            v-for="seg in 4"
            :key="`seg-${seg}`"
            class="meter-seg"
            :class="`seg-${seg - 1}`"
            :style="segStyle(seg - 1)"
          />
          <i
            v-for="tick in minorTicks"
            :key="`mt-${tick}`"
            class="meter-minor"
            :style="{ left: pct(tick) }"
          />
          <i
            v-for="bound in meterBounds"
            :key="`mb-${bound}`"
            class="meter-bound"
            :style="{ left: pct(bound) }"
          />
          <div
            class="meter-fill"
            :class="DEGREE_META[row.degree].cls"
            :style="{ width: pct(row.five.pulls) }"
          />
          <i
            class="meter-tip"
            :class="DEGREE_META[row.degree].cls"
            :style="{ left: pct(row.five.pulls) }"
          />
        </div>
        <span
          class="wish-degree"
          :class="DEGREE_META[row.degree].cls"
        >{{ DEGREE_META[row.degree].label }}</span>
        <span class="wish-q">{{ row.five.incomplete ? '—' : row.five.pulls }}</span>
        <span class="wish-qu">抽</span>
        <span
          v-if="row.five.off !== null"
          class="wish-bd"
          :class="row.five.off ? 'lost' : 'ok'"
        >{{ row.five.off ? '歪' : '不歪' }}</span>
        <span
          v-else
          class="wish-bd blank"
        />
      </li>
    </ol>
    <footer class="timeline-foot">
      <span>共 {{ rows.length }} 次五星</span>
      <button
        type="button"
        class="ledger-link"
        @click="$emit('open-ledger')"
      >
        完整流水
      </button>
    </footer>
  </section>
</template>

<style scoped>
.timeline {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.timeline-head {
  flex: none;
  display: flex;
  align-items: baseline;
  gap: 14px;
  padding: 14px 26px 10px;
}

.th-sub {
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--dim);
  letter-spacing: 0.06em;
}

.th-note {
  margin-left: auto;
  font-size: 11.5px;
  font-family: var(--font-mono);
  color: var(--dim);
  letter-spacing: 0.06em;
}

.th-badges {
  display: inline-flex;
  gap: 8px;
}

.count-badge {
  font-style: normal;
  font-size: 11.5px;
  letter-spacing: 0.06em;
}

.timeline-empty {
  margin: 0;
  padding: 32px 26px;
  font-size: 12.5px;
  color: var(--dim);
  letter-spacing: 0.06em;
}

.timeline-rows {
  list-style: none;
  margin: 0;
  padding: 0;
}

/* 对齐轨:章 | 名 | 量距条 | 档位词右缘 | 数字个位 | 单位 | 结果章(DESIGN §3) */
.wish-row {
  display: grid;
  grid-template-columns: 44px minmax(140px, 1.1fr) minmax(170px, 1.8fr) 58px 52px 20px 58px;
  align-items: center;
  column-gap: 14px;
  min-height: 64px;
  padding: 7px 10px 7px 16px;
  border-bottom: 1px solid var(--line-soft);
}

.wish-row.rare {
  box-shadow: inset 3px 0 0 var(--rare-edge);
}

.wish-row.rare-super-lucky {
  background: var(--rare-bg-super-lucky);
  --rare-edge: var(--rare-edge-super-lucky);
}

.wish-row.rare-unlucky {
  background: var(--rare-bg-unlucky);
  --rare-edge: var(--rare-edge-unlucky);
}

.wish-seal {
  position: relative;
  width: 38px;
  height: 38px;
  margin-left: 6px;
}

.wish-seal::before {
  content: '';
  position: absolute;
  inset: 0;
  border: 1.5px solid var(--accent-deep);
  border-radius: 5px;
  transform: rotate(45deg);
  background: var(--seal-bg);
}

.wish-seal::after {
  content: '';
  position: absolute;
  inset: 4px;
  border: 1px solid var(--seal-inner);
  border-radius: 3px;
  transform: rotate(45deg);
}

.wish-seal > span {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 500;
  color: var(--accent);
}

/* 图标形态(ADR-0005):立像按菱形裁切镶嵌在内描边之内,底色/双描边沿用 */
.wish-seal .seal-img {
  position: absolute;
  inset: 6px;
  object-fit: cover;
  clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
}

.wish-name {
  min-width: 0;
}

.nm1 {
  font-size: 15px;
  font-weight: 600;
  color: var(--accent);
  letter-spacing: 0.05em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nm-tag {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 400;
  color: var(--mut);
  margin-left: 8px;
}

.nm2 {
  margin-top: 5px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--dim);
  letter-spacing: 0.04em;
}

/* —— 量距条:条长 = 垫抽数,条色 = 欧非档,背景轨四段分段与界线刻度 —— */
.meter {
  position: relative;
  height: 30px;
}

.meter.incomplete {
  opacity: 0.45;
}

.meter-seg {
  position: absolute;
  top: 5px;
  bottom: 5px;
}

.meter-seg.seg-0 {
  background: var(--meter-seg-0);
}

.meter-seg.seg-1 {
  background: var(--meter-seg-1);
}

.meter-seg.seg-2 {
  background: var(--meter-seg-2);
}

.meter-seg.seg-3 {
  background: var(--meter-seg-3);
}

.meter-minor {
  position: absolute;
  bottom: 2px;
  width: 1px;
  height: 4px;
  background: var(--dim);
  opacity: 0.5;
}

.meter-bound {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--line);
}

.meter-fill {
  position: absolute;
  left: 0;
  top: 5px;
  bottom: 5px;
  border-radius: 4px 0 0 4px;
}

.meter-tip {
  position: absolute;
  top: 50%;
  width: 9px;
  height: 9px;
  transform: translate(-50%, -50%) rotate(45deg);
  border: 2px solid var(--tip-stroke);
}

.meter-fill.deg-super-lucky,
.meter-tip.deg-super-lucky {
  background: var(--zone-super-lucky);
}

.meter-fill.deg-lucky,
.meter-tip.deg-lucky {
  background: var(--zone-lucky);
}

.meter-fill.deg-normal,
.meter-tip.deg-normal {
  background: var(--zone-normal);
}

.meter-fill.deg-unlucky,
.meter-tip.deg-unlucky {
  background: var(--zone-unlucky);
}

/* —— 结果区:档位词/数字/单位/结果章四列垂直轨 —— */
.wish-degree {
  font-size: 14px;
  font-weight: 600;
  text-align: right;
  letter-spacing: 0.06em;
}

.wish-degree.deg-super-lucky {
  color: var(--zone-super-lucky);
}

.wish-degree.deg-lucky {
  color: var(--zone-lucky);
}

.wish-degree.deg-normal {
  color: var(--zone-normal);
}

.wish-degree.deg-unlucky {
  color: var(--zone-unlucky);
}

.wish-q {
  font-family: var(--font-num);
  font-size: 23px;
  text-align: right;
  color: var(--fg);
}

.wish-qu {
  font-size: 11.5px;
  color: var(--dim);
}

.wish-bd {
  justify-self: end;
  width: 52px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  border-radius: 7px;
  letter-spacing: 0.14em;
}

.wish-bd.ok {
  color: var(--jade);
  border: 1px solid var(--jade-bd);
  background: var(--jade-bg);
}

.wish-bd.lost {
  color: var(--btn-ink);
  background: var(--cinnabar);
  border: 1px solid var(--cinnabar);
}

.wish-bd.blank {
  visibility: hidden;
}

.timeline-foot {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 26px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--dim);
  letter-spacing: 0.06em;
}

.ledger-link {
  border: none;
  background: none;
  padding: 0;
  font-family: inherit;
  font-size: inherit;
  letter-spacing: inherit;
  color: var(--accent);
  cursor: pointer;
}

.ledger-link:hover {
  text-decoration: underline;
}
</style>
