<script setup lang="ts">
import { computed } from 'vue'
import { poolLabel, type PoolCategory } from '@/domain/pools'
import { avatarFor, DEGREE_META } from './boardDisplay'
import type { TimelineRow } from '@/stores/board'

/** 时间线:姓名区叠印(仅超欧/超非),量距条 + 抽数 + 本次保底/结果。 */
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

/** 超欧/超非 = 稀有行(独立洗色 token,双主题等权) */
function rowClass(row: TimelineRow): string[] {
  const classes: string[] = []
  if (row.degree === 'superLucky') classes.push('rare', 'rare-super-lucky')
  if (row.degree === 'unlucky') classes.push('rare', 'rare-unlucky')
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
  return `出货 ${row.five.pulls} 抽 · ${DEGREE_META[row.degree].label}`
}
</script>

<template>
  <section
    class="timeline"
    aria-label="祈愿时间线"
  >
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
          :class="{ icon: avatar.kind === 'icon' }"
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
          <div class="wish-heading">
            <div class="nm1">
              {{ row.five.record.name }}<span
                v-if="row.tag !== null"
                class="nm-tag"
              >· {{ row.tag }}</span>
            </div>
            <svg
              v-if="row.degree === 'superLucky' || row.degree === 'unlucky'"
              class="fortune-seal"
              :class="DEGREE_META[row.degree].cls"
              viewBox="0 0 72 72"
              role="img"
              :aria-label="DEGREE_META[row.degree].label"
            >
              <circle class="seal-outer" cx="36" cy="36" r="29" />
              <circle class="seal-inner" cx="36" cy="36" r="25" />
              <text x="36" y="47" text-anchor="middle">{{ row.degree === 'superLucky' ? '欧' : '非' }}</text>
            </svg>
          </div>
          <div
            class="nm2"
            :title="`${row.five.record.time} · ${poolLabel(row.five.record.gachaType)}`"
          >
            {{ row.five.record.time.slice(0, 16) }} · 池 {{ row.five.record.gachaType }}
          </div>
        </div>
        <div
          class="meter"
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
        <span class="wish-q">{{ row.five.pulls }}</span>
        <span class="wish-qu">抽</span>
        <span
          v-if="row.five.off !== null"
          class="wish-bd"
          :class="[row.five.off ? 'lost' : 'ok', { guaranteed: row.pity === 'guaranteed' }]"
          :title="row.pity === 'unknown' ? '历史不足或序列异常,无法确认本次保底类型' : '根据已保存的角色活动祈愿历史判断本次保底类型'"
        >
          <span class="wish-pity">{{ row.pity === 'guaranteed' ? '大保底' : row.pity === 'small' ? '小保底' : '待确认' }}</span>
          <span class="wish-result">{{ row.five.off ? '歪' : row.pity === 'guaranteed' ? '必中' : '不歪' }}</span>
        </span>
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
  /* 原头部行的高距并入此处(与 RosterView 头部 14px 同距),标题行不再双行占位 */
  padding-top: 14px;
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

/* 姓名/日期/圆印组成紧凑的固定宽度信息区;量距条独占剩余宽度。
 * 避免宽窗把姓名与圆印拉开,所有行(含无印章行)保持同一量距条起点。
 * 216px 容纳完整日期+池 code;印章随上方文字末尾定位。 */
.wish-row {
  display: grid;
  grid-template-columns: 54px 216px minmax(140px, 1fr) 42px 16px 76px;
  align-items: center;
  column-gap: 12px;
  min-height: 70px;
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
  width: 48px;
  height: 48px;
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

/* 图标形态(ADR-0005):整像圆形呈现——外框改环、去内菱形线,不用菱形裁切头像 */
.wish-seal.icon::before {
  transform: none;
  border-radius: 50%;
}

.wish-seal.icon::after {
  display: none;
}

/* img 须显定宽高居中:<img> 是替换元素,inset 不缩放固有尺寸(256 原图溢出即此因) */
.wish-seal .seal-img {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 42px;
  height: 42px;
  transform: translate(-50%, -50%);
  object-fit: contain;
}

.wish-name {
  position: relative;
  min-width: 0;
}

/* 锚定实际姓名/命座宽度,短名也能贴近落印;圈边轻叠姓名末尾及下方日期,章字保持在两行之间。 */
.wish-heading {
  position: relative;
  width: fit-content;
  max-width: calc(100% - 44px);
}

.fortune-seal {
  position: absolute;
  width: 52px;
  height: 52px;
  left: calc(100% - 13px);
  top: -9px;
  transform: rotate(12deg);
  pointer-events: none;
  color: var(--stamp-unlucky);
  mask-image: url('../../assets/seal-grain.svg');
  mask-size: 100% 100%;
}

.fortune-seal.deg-super-lucky {
  color: var(--stamp-super-lucky);
  transform: rotate(-10deg);
}

.fortune-seal circle {
  fill: none;
  stroke: currentColor;
}

.seal-outer {
  stroke-width: 2.2;
  stroke-dasharray: 51 1.5 32 2 70 1 25;
}

.seal-inner {
  stroke-width: 0.9;
  stroke-dasharray: 72 0.8 40 1.5 44;
}

.fortune-seal text {
  fill: currentColor;
  font-family: 'Songti SC', 'SimSun', 'Noto Serif CJK SC', serif;
  font-size: 34px;
  font-weight: 700;
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
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 9px;
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

/* —— 结果区:数字个位 / 单位 / 保底条件与结果 —— */
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
  width: 76px;
  min-height: 49px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid var(--jade-bd);
  border-radius: 5px;
  background: var(--jade-bg);
  color: var(--jade);
}

.wish-pity {
  font-size: 11px;
  color: var(--mut);
  line-height: 1.2;
}

.wish-result {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: 0.1em;
}

.wish-bd.lost {
  color: var(--stamp-unlucky);
  border-color: var(--rare-edge-unlucky);
  background: var(--rare-bg-unlucky);
}

.wish-bd.guaranteed {
  color: var(--accent);
  border-color: var(--raise-border);
  background: var(--accent-wash);
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
