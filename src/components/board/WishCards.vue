<script setup lang="ts">
import { computed, ref } from 'vue'
import { avatarFor, DEGREE_META } from './boardDisplay'
import { poolLabel, type PoolCategory } from '@/domain/pools'
import type { WishRecord } from '@/domain/records'
import { EVENT_CHAR_EXPECTED, EVENT_WEAPON_EXPECTED } from '@/domain/verdict'
import type { TimelineRow } from '@/stores/board'

const props = defineProps<{ rows: TimelineRow[]; scope: PoolCategory; meterHard: number }>()
const emit = defineEmits<{ 'open-record': [record: WishRecord] }>()
// 以源记录引用选中，避免同秒同名的多条迁入记录串选。
const selection = ref<WishRecord | null>(null)
const selected = computed(() => props.rows.find((row) => row.five.record === selection.value) ?? props.rows[0])
const cards = computed(() => props.rows.map((row) => ({ row, avatar: avatarFor(row.five.record.name) })))
const expected = computed(() => props.scope === 'eventWeapon' ? EVENT_WEAPON_EXPECTED : EVENT_CHAR_EXPECTED)
function pct(pulls: number): string {
  return `${Math.min(100, Math.max(0, pulls / props.meterHard * 100))}%`
}
function result(row: TimelineRow): string {
  if (row.five.off === null) return ''
  const pity = row.pity === 'guaranteed' ? '大保底' : row.pity === 'small' ? '小保底' : '待确认'
  return `${pity} · ${row.five.off ? '歪' : row.pity === 'guaranteed' ? '必中' : '不歪'}`
}
</script>

<template>
  <section class="wish-cards" aria-label="五星祈愿卡片">
    <p v-if="rows.length === 0" class="cards-empty">该池暂无五星出货记录</p>
    <div v-else class="cards-scroll">
      <ol class="cards-grid">
        <li v-for="({ row, avatar }, index) in cards" :key="index">
          <button
            type="button"
            class="wish-card"
            :class="[DEGREE_META[row.degree].cls, { selected: selected === row }]"
            :aria-pressed="selected === row"
            :aria-label="`${row.five.record.name}，${row.five.pulls} 抽，${DEGREE_META[row.degree].label}，${result(row)}，${row.five.record.time}`"
            @click="selection = row.five.record"
          >
            <span class="card-avatar" aria-hidden="true">
              <img v-if="avatar.kind === 'icon'" :src="avatar.url" alt="">
              <span v-else>{{ avatar.char }}</span>
            </span>
            <span class="card-name" :title="row.five.record.name">{{ row.five.record.name }}</span>
            <span class="card-tag">{{ row.tag ?? '五星' }}</span>
            <span class="card-pulls" :class="{ long: row.five.pulls >= 100 }" :title="`${row.five.pulls} 抽`">{{ row.five.pulls }}</span>
            <span class="card-unit">抽</span>
            <span
              class="card-result"
              :class="{ lost: row.five.off === true, guaranteed: row.pity === 'guaranteed' }"
            >{{ result(row) }}</span>
            <svg
              v-if="row.degree === 'superLucky' || row.degree === 'unlucky'"
              class="card-seal"
              viewBox="0 0 82 82"
              aria-hidden="true"
            >
              <circle class="seal-outer" cx="41" cy="41" r="34" />
              <circle class="seal-inner" cx="41" cy="41" r="30" />
              <text class="seal-letter" x="41" y="49">{{ row.degree === 'superLucky' ? '欧' : '非' }}</text>
              <text class="seal-caption" x="41" y="64">{{ DEGREE_META[row.degree].label }}</text>
            </svg>
            <span v-else class="card-degree">{{ DEGREE_META[row.degree].label }}</span>
            <span class="card-meter" :title="`${row.five.pulls} / ${meterHard} 抽；刻线为 ${expected} 抽期望参考`" aria-hidden="true">
              <i class="card-meter-fill" :style="{ width: pct(row.five.pulls) }" />
              <i class="card-meter-reference" :style="{ left: pct(expected) }" />
            </span>
            <span class="card-date">{{ row.five.record.time.slice(0, 10) }}</span>
            <span class="card-code" :title="poolLabel(row.five.record.gachaType)">池 {{ row.five.record.gachaType }}</span>
          </button>
        </li>
      </ol>
    </div>
    <div v-if="selected" class="card-detail" aria-live="polite">
      <strong :title="selected.five.record.name">已选 · {{ selected.five.record.name }}</strong>
      <span>{{ selected.five.record.time }}</span>
      <span>{{ poolLabel(selected.five.record.gachaType) }}</span>
      <span>{{ selected.five.pulls }} 抽 · {{ DEGREE_META[selected.degree].label }}<template v-if="result(selected)"> · {{ result(selected) }}</template></span>
      <button type="button" @click="emit('open-record', selected.five.record)">在流水中查看 →</button>
    </div>
  </section>
</template>

<style scoped>
.wish-cards {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-top: 16px;
}
.cards-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 3px 26px 18px;
}
.cards-grid {
  display: grid;
  /* 固定五列，随左栏等分宽度，不再因 220px 最小宽度自动降列。 */
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.cards-grid > li {
  min-width: 0;
  container: wish-card-slot / inline-size;
}
.wish-card {
  --card-ink: var(--zone-normal);
  position: relative;
  display: block;
  width: 100%;
  height: 132px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--raise);
  color: var(--fg);
  text-align: left;
  cursor: pointer;
}
.wish-card::before {
  content: '';
  position: absolute;
  left: 15px;
  top: -1px;
  width: 40px;
  border-top: 2px solid var(--dim);
}
.wish-card:hover {
  border-color: var(--accent-2);
}
.wish-card.selected {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 2px var(--bg), inset 0 0 0 3px var(--raise-border);
}
.wish-card:focus-visible, .card-detail button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
.deg-super-lucky {
  --card-ink: var(--stamp-super-lucky);
  background: var(--rare-bg-super-lucky);
}
.deg-unlucky {
  --card-ink: var(--stamp-unlucky);
  background: var(--rare-bg-unlucky);
}
.deg-lucky {
  --card-ink: var(--zone-lucky);
}
.card-avatar {
  position: absolute;
  left: 15px;
  top: 12px;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 1px solid var(--raise-border);
  border-radius: 50%;
  background: var(--accent-wash);
  color: var(--accent);
}
.card-avatar img {
  width: 34px;
  height: 34px;
  object-fit: contain;
}
.card-name {
  position: absolute;
  left: 62px;
  top: 12px;
  max-width: calc(100% - 78px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--accent);
  font-size: 16px;
  font-weight: 600;
}
.card-tag {
  position: absolute;
  left: 62px;
  top: 36px;
  font-size: 10px;
  color: var(--mut);
}
.card-pulls {
  position: absolute;
  left: 15px;
  top: 52px;
  font: 40px/1 var(--font-num);
  color: var(--card-ink);
}
.card-pulls.long {
  font-size: 30px;
  top: 62px;
  max-width: 65px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-unit {
  position: absolute;
  left: 82px;
  top: 78px;
  font-size: 10px;
  color: var(--mut);
}
.card-result {
  position: absolute;
  right: 15px;
  top: 78px;
  font-size: 10px;
  color: var(--jade);
}
.card-result.lost {
  color: var(--stamp-unlucky);
}
.card-result.guaranteed {
  color: var(--accent);
}
.card-degree {
  position: absolute;
  right: 15px;
  top: 38px;
  font-size: 11px;
  color: var(--card-ink);
}
.card-seal {
  position: absolute;
  right: 26px;
  top: 1px;
  width: 82px;
  height: 82px;
  color: var(--card-ink);
  opacity: 0.73;
  transform: rotate(13deg);
  pointer-events: none;
  mask-image: url('../../assets/seal-grain.svg');
  mask-size: 100% 100%;
}
.deg-super-lucky .card-seal {
  transform: rotate(-15deg);
}
.card-seal circle {
  fill: none;
  stroke: currentColor;
}
.seal-outer {
  stroke-width: 2;
  stroke-dasharray: 51 1.5 32 2 70 1 25;
}
.seal-inner {
  stroke-width: 1;
}
.card-seal text {
  fill: currentColor;
  text-anchor: middle;
}
.seal-letter {
  font: 700 37px 'Songti SC', SimSun, serif;
}
.seal-caption {
  font-size: 9px;
}
.card-meter {
  position: absolute;
  top: 101px;
  left: 15px;
  right: 15px;
  height: 3px;
  background: var(--meter-track);
}
.card-meter-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--card-ink);
}
.card-meter-reference {
  position: absolute;
  top: -3px;
  height: 9px;
  width: 1px;
  background: var(--mut);
}
.card-date, .card-code {
  position: absolute;
  top: 114px;
  font-size: 10px;
  color: var(--mut);
}
.card-date {
  left: 15px;
  font-family: var(--font-mono);
}
.card-code {
  right: 15px;
}
.card-detail {
  flex: none;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 18px;
  margin: 0 26px 16px;
  padding: 12px 16px;
  border-radius: 4px;
  background: var(--accent-wash);
  color: var(--mut);
  font-size: 11px;
}
.card-detail strong {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--accent);
}
.card-detail button {
  margin-left: auto;
  border: 0;
  padding: 4px 0;
  background: none;
  color: var(--accent);
  cursor: pointer;
  white-space: nowrap;
}
.cards-empty {
  padding: 24px 26px;
  color: var(--mut);
  font-size: 13px;
}
/* 默认桌面宽度下五列卡片更窄：结果独占一行，保留可读字号与完整抽数。 */
@container wish-card-slot (max-width: 200px) {
  .card-avatar { left: 10px; width: 30px; height: 30px; }
  .card-avatar img { width: 28px; height: 28px; }
  .card-name { left: 48px; max-width: calc(100% - 58px); font-size: 13px; }
  .card-tag { left: 48px; top: 32px; }
  .card-pulls { left: 10px; top: 51px; font-size: 32px; }
  .card-pulls.long { top: 57px; font-size: 26px; }
  .card-unit { left: 66px; top: 71px; }
  .card-result { right: 10px; top: 87px; }
  .card-degree { right: 10px; top: 42px; }
  .card-seal { right: 4px; top: 4px; width: 64px; height: 64px; }
  .card-meter { left: 10px; right: 10px; top: 104px; }
  .card-date { left: 10px; }
  .card-code { right: 10px; }
}
@container board (max-width: 1150px) {
  .cards-scroll {
    flex: none;
    overflow: visible;
  }
}
</style>
