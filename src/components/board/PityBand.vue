<script setup lang="ts">
import { computed } from 'vue'
import { FOUR_STAR_HARD_PITY } from '@/domain/pools'
import type { PoolStats } from '@/domain/stats'
import { tabFor } from '@/domain/poolTabs'

/**
 * 保底仪 PityBand(V5 通栏仪器带,页签正下方,DESIGN §3.1):
 * 大数字垫抽数 + 大小保底状态章 + 次级读数组(距软/距硬/四星)+ 刻度标尺
 * (0–hard 主刻度、softFrom 起软区斜纹、软/硬界线、菱形游标)。
 * 软区 74/63 与硬保底 90/80 只取 stats.pity,不在此重复定义;pity 为 null
 * 的作用域(novice/unknown)整带隐藏,作用域 totalPulls===0 时显空态(T17 返工 #2);
 * 距软/距硬为负(数据有洞)照实显示并加 title 提示,不钳制(T17 返工 #3)。
 */
const props = defineProps<{ stats: PoolStats }>()

const pity = computed(() => props.stats.pity)
const label = computed(() => tabFor(props.stats.scope).label)

/** 距软/距硬剩余抽数(数据有洞可为负,照实显示不钳制,spec D7) */
const softRemaining = computed(() => (pity.value ? pity.value.softFrom - pity.value.current : 0))
const hardRemaining = computed(() => (pity.value ? pity.value.hard - pity.value.current : 0))

/** 作用域无任何记录:保底进度无从谈起,显空态而非 0/90(T17 返工 #2) */
const isEmpty = computed(() => props.stats.totalPulls === 0)

/** 距软/距硬的缺口提示(仅负值出现;title 兜底,不改变数值) */
function gapTitle(remaining: number): string | undefined {
  return remaining < 0 ? '数据存在缺口' : undefined
}

/** 大小保底状态章(spec D5:仅 eventChar 有 guarantee;其余作用域不显示状态章) */
const badge = computed<{ text: string; cls: string } | null>(() => {
  if (props.stats.guarantee === 'guaranteed') {
    return { text: '大保底就绪 · 下一金必中', cls: 'guaranteed' }
  }
  if (props.stats.guarantee === 'fiftyFifty') {
    return { text: '小保底 · 下一金未必 UP', cls: 'fifty' }
  }
  return null
})

/** 标尺主刻度(每 10 抽一道,含 0 与 hard) */
const majorTicks = computed(() => {
  const hard = pity.value?.hard ?? 90
  const ticks: number[] = []
  for (let value = 0; value <= hard; value += 10) ticks.push(value)
  return ticks
})

/** 标尺百分比(数据有洞 current 超 hard 时照实溢出,不钳制,spec D7) */
function pct(value: number, hard: number): string {
  return `${(value / hard) * 100}%`
}
</script>

<template>
  <section
    v-if="pity !== null"
    class="pity-band"
    aria-label="保底状态"
  >
    <div class="pity-head">
      <span class="pity-pool">{{ label }} · 保底状态</span>
      <span class="pity-tag">PITY INSTRUMENT</span>
      <span
        v-if="badge !== null && !isEmpty"
        class="pity-badge"
        :class="badge.cls"
      ><i
        class="d"
        aria-hidden="true"
      />{{ badge.text }}</span>
    </div>
    <p
      v-if="isEmpty"
      class="pity-empty"
    >
      该池暂无祈愿记录 · 保底进度自首抽起计
    </p>
    <template v-else>
      <div class="pity-main">
        <div class="pity-val">
          {{ pity.current }}
        </div>
        <span class="pity-unit">抽</span>
        <div class="pity-side">
          <div class="pity-cap">当前垫抽数 · 自上次五星起累计</div>
        </div>
        <i
          class="pity-trace"
          aria-hidden="true"
        />
        <div class="pity-reads">
          <div class="read">
            <div class="k">距软保底</div>
            <div
              class="v"
              :title="gapTitle(softRemaining)"
            >
              {{ softRemaining }}<i>抽</i>
            </div>
          </div>
          <div class="read hi">
            <div class="k">距硬保底</div>
            <div
              class="v"
              :title="gapTitle(hardRemaining)"
            >
              {{ hardRemaining }}<i>抽</i>
            </div>
          </div>
          <div class="read">
            <div class="k">四星保底</div>
            <div class="v">
              {{ stats.fourPity.current }}<i>/ {{ FOUR_STAR_HARD_PITY }}</i>
            </div>
          </div>
        </div>
      </div>
      <div
        class="pity-scale"
        role="img"
        :aria-label="`保底进度 ${pity.current} / ${pity.hard} 抽`"
      >
        <div class="scale-track">
          <div
            class="scale-fill"
            :style="{ width: pct(pity.current, pity.hard) }"
          />
          <div
            class="scale-soft"
            :style="{ left: pct(pity.softFrom, pity.hard) }"
          />
          <i
            v-for="value in [pity.softFrom, pity.hard]"
            :key="value"
            class="scale-boundary"
            :style="{ left: pct(value, pity.hard) }"
          />
        </div>
        <i
          v-for="tick in majorTicks"
          :key="`tick-${tick}`"
          class="scale-tick"
          :style="{ left: pct(tick, pity.hard) }"
        />
        <span
          v-for="tick in majorTicks"
          :key="`num-${tick}`"
          class="scale-num"
          :class="{ start: tick === 0, end: tick === pity.hard }"
          :style="{ left: pct(tick, pity.hard) }"
        >{{ tick }}</span>
        <span
          class="scale-label soft"
          :style="{ left: pct(pity.softFrom, pity.hard) }"
        >软保底 {{ pity.softFrom }}</span>
        <span
          class="scale-label hard"
          :style="{ left: pct(pity.hard, pity.hard) }"
        >硬保底 {{ pity.hard }}</span>
        <i
          class="scale-cursor"
          :style="{ left: pct(pity.current, pity.hard) }"
        >
          <i
            class="halo"
            aria-hidden="true"
          /><i
            class="diamond"
            aria-hidden="true"
          />
        </i>
      </div>
    </template>
  </section>
</template>

<style scoped>
.pity-band {
  flex: none;
  padding: 16px 26px 0;
  border-bottom: 1px solid var(--line);
}

.pity-head {
  display: flex;
  align-items: center;
  gap: 14px;
}

/* 空态(作用域 totalPulls===0,返工 #2) */
.pity-empty {
  margin: 0;
  padding: 18px 0 20px;
  font-size: 12px;
  color: var(--dim);
  letter-spacing: 0.06em;
}

.pity-pool {
  font-size: 13px;
  color: var(--mut);
  letter-spacing: 0.08em;
}

.pity-tag {
  font-family: var(--font-tech);
  font-weight: 300;
  font-size: 11px;
  letter-spacing: 0.26em;
  color: var(--dim);
}

.pity-main {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  margin-top: 2px;
}

.pity-val {
  font-family: var(--font-num);
  font-size: 76px;
  line-height: 0.86;
  color: var(--jade);
}

.pity-unit {
  font-size: 14px;
  color: var(--mut);
  padding-bottom: 6px;
}

.pity-side {
  padding-bottom: 6px;
}

.pity-badge {
  margin-left: auto;
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
  padding: 7px 14px;
  letter-spacing: 0.06em;
}

.pity-badge .d {
  width: 7px;
  height: 7px;
  transform: rotate(45deg);
  background: currentColor;
}

.pity-badge.guaranteed {
  color: var(--jade);
  background: var(--jade-bg);
  border: 1px solid var(--jade-bd);
}

.pity-badge.fifty {
  color: var(--mut);
  background: var(--seal-bg);
  border: 1px solid var(--line);
}

.pity-cap {
  padding-bottom: 6px;
  font-size: 11.5px;
  color: var(--dim);
  letter-spacing: 0.08em;
}

/* 仪器走线:徽章桥接次级读数组 */
.pity-trace {
  flex: 1;
  align-self: flex-end;
  border-top: 1px solid var(--line-soft);
  margin: 0 20px 26px;
}

.pity-reads {
  display: flex;
  align-items: flex-end;
  padding-bottom: 6px;
}

.read {
  padding: 0 18px;
  text-align: right;
}

.read + .read {
  border-left: 1px solid var(--line-soft);
}

.read:last-child {
  padding-right: 2px;
}

.read .k {
  font-size: 11.5px;
  color: var(--mut);
  letter-spacing: 0.1em;
  margin-bottom: 6px;
}

.read .v {
  font-family: var(--font-num);
  font-size: 30px;
  line-height: 1;
  color: var(--fg);
}

.read .v i {
  font-style: normal;
  font-family: var(--font-cjk);
  font-size: 11px;
  color: var(--dim);
  margin-left: 4px;
}

.read.hi .v {
  color: var(--accent-2);
}

/* —— 刻度标尺 —— */
.pity-scale {
  position: relative;
  height: 58px;
  margin-top: 12px;
}

.scale-track {
  position: absolute;
  inset: 0 0 18px;
  border-radius: 4px;
  background: var(--pity-track);
  overflow: visible;
}

.scale-fill {
  height: 100%;
  border-radius: 4px 0 0 4px;
  background: linear-gradient(180deg, var(--pity-fill-a) 0%, var(--pity-fill-b) 100%);
}

/* 软区斜纹(自 softFrom 起,叠于轨道) */
.scale-soft {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  background: repeating-linear-gradient(
    45deg,
    var(--pity-hatch) 0,
    var(--pity-hatch) 1px,
    transparent 1px,
    transparent 6px
  );
  opacity: 0.4;
}

.scale-boundary {
  position: absolute;
  top: -5px;
  bottom: -5px;
  width: 1px;
  background: var(--pity-boundary);
}

.scale-tick {
  position: absolute;
  bottom: 12px;
  width: 1px;
  height: 9px;
  background: var(--dim);
  opacity: 0.55;
}

.scale-num {
  position: absolute;
  bottom: 0;
  transform: translateX(-50%);
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--dim);
}

.scale-num.start {
  transform: none;
}

.scale-num.end {
  transform: translateX(-100%);
}

.scale-label {
  position: absolute;
  top: -16px;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: var(--accent-2);
}

.scale-label.soft {
  transform: translateX(-50%);
}

.scale-label.hard {
  transform: translateX(-100%);
}

.scale-cursor {
  position: absolute;
  top: calc((100% - 18px) / 2);
}

.scale-cursor .halo {
  position: absolute;
  left: 0;
  top: 0;
  width: 22px;
  height: 22px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: var(--jade-bg);
}

.scale-cursor .diamond {
  position: absolute;
  left: 0;
  top: 0;
  width: 11px;
  height: 11px;
  transform: translate(-50%, -50%) rotate(45deg);
  background: var(--jade);
  border: 2px solid var(--tip-stroke);
}
</style>
