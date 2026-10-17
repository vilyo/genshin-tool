<script setup lang="ts">
import { computed } from 'vue'
import type { PoolCategory } from '@/domain/pools'
import type { RosterView } from '@/domain/roster'
import { ROSTER_CONSTELLATION_NOTE } from '@/domain/roster'
import { avatarFor, acquireTag } from './boardDisplay'

/**
 * 五星名册(左栏补充视图,spec 04 §4):按物品分组的卡片——头像章(ADR-0005 内置图标
 * 整像圆形呈现、环框镶嵌,未知名回退首字菱形占位章)+ 名 + 获取列表
 * (新的在前:拉数/歪章/日期/池名),顶部汇总芯片(UP n · 歪 n · 超欧 n · 超非 n),
 * 尾注 ROSTER_CONSTELLATION_NOTE。数据全部来自 buildRoster 产物;C/R 标注经
 * acquireTag(scope, …) 选型(constellationOf/refinementOf 换算),组件零口径。
 */
const props = defineProps<{
  roster: RosterView
  scope: PoolCategory
}>()

const summary = computed(() => props.roster.summary)

/** 卡片 + 头像解析一次算好(avatarFor:清单命中为内置图标,否则首字占位章) */
const cards = computed(() =>
  props.roster.cards.map((card) => ({ card, avatar: avatarFor(card.name) })),
)
</script>

<template>
  <section
    class="roster"
    aria-label="五星名册"
  >
    <header class="roster-head">
      <span class="rh-sub">按物品分组 · 获取独立逐条</span>
      <span class="rh-chips">
        <i
          v-if="summary.up !== null"
          class="chip ok"
        >UP {{ summary.up }}</i>
        <i
          v-if="summary.off !== null"
          class="chip lost"
        >歪 {{ summary.off }}</i>
        <i class="chip deg-super-lucky">超欧 {{ summary.superLucky }}</i>
        <i class="chip deg-unlucky">超非 {{ summary.unlucky }}</i>
      </span>
    </header>
    <p
      v-if="roster.cards.length === 0"
      class="roster-empty"
    >
      该池暂无五星出货记录
    </p>
    <div class="roster-cards">
      <article
        v-for="{ card, avatar } in cards"
        :key="card.name"
        class="roster-card"
      >
        <header class="card-head">
          <span
            class="card-seal"
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
          <h3 class="card-name">
            {{ card.name }}
            <span class="card-count">{{ card.acquisitions.length }}</span>
          </h3>
        </header>
        <ul class="card-list">
          <li
            v-for="(acquisition, index) in card.acquisitions"
            :key="`${acquisition.date}-${index}`"
            class="card-item"
          >
            <span class="ci-q">{{ acquisition.incomplete ? '—' : acquisition.pulls }} 抽</span>
            <span
              v-if="acquisition.off !== null"
              class="ci-off"
              :class="acquisition.off ? 'lost' : 'ok'"
            >{{ acquisition.off ? '歪' : '不歪' }}</span>
            <span
              v-if="acquireTag(scope, card.name, acquisition.globalIndex) !== null"
              class="ci-tag"
            >{{ acquireTag(scope, card.name, acquisition.globalIndex) }}</span>
            <span class="ci-meta">{{ acquisition.date }} · {{ acquisition.pool }}</span>
          </li>
        </ul>
      </article>
    </div>
    <footer class="roster-foot">
      {{ ROSTER_CONSTELLATION_NOTE }}
    </footer>
  </section>
</template>

<style scoped>
.roster {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.roster-head {
  flex: none;
  display: flex;
  align-items: baseline;
  gap: 14px;
  padding: 14px 26px 10px;
}

.rh-sub {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--dim);
  letter-spacing: 0.06em;
}

.rh-chips {
  margin-left: auto;
  display: inline-flex;
  gap: 8px;
}

.chip {
  font-style: normal;
  font-size: 11.5px;
  letter-spacing: 0.06em;
  border-radius: 6px;
  padding: 3px 8px;
  border: 1px solid var(--line);
  color: var(--mut);
}

.chip.ok {
  color: var(--jade);
  border-color: var(--jade-bd);
  background: var(--jade-bg);
}

.chip.lost {
  color: var(--cinnabar);
  border-color: var(--cinnabar);
  background: transparent;
}

.chip.deg-super-lucky {
  color: var(--zone-super-lucky);
}

.chip.deg-unlucky {
  color: var(--zone-unlucky);
}

.roster-empty {
  margin: 0;
  padding: 32px 26px;
  font-size: 12.5px;
  color: var(--dim);
  letter-spacing: 0.06em;
}

.roster-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
  padding: 4px 26px;
}

.roster-card {
  border: 1px solid var(--line-soft);
  border-radius: 10px;
  background: var(--seal-bg);
  padding: 12px 14px;
}

.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line-soft);
}

.card-seal {
  position: relative;
  width: 32px;
  height: 32px;
  flex: none;
}

.card-seal::before {
  content: '';
  position: absolute;
  inset: 0;
  border: 1.2px solid var(--accent-deep);
  border-radius: 4px;
  transform: rotate(45deg);
  background: var(--seal-bg);
}

.card-seal > span {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 500;
  color: var(--accent);
}

/* 图标形态(ADR-0005):整像圆形呈现——外框改环,不用菱形裁切头像 */
.card-seal.icon::before {
  transform: none;
  border-radius: 50%;
}

/* img 须显定宽高居中:<img> 是替换元素,inset 不缩放固有尺寸 */
.card-seal .seal-img {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 26px;
  height: 26px;
  transform: translate(-50%, -50%);
  object-fit: contain;
}

.card-name {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--accent);
  letter-spacing: 0.05em;
}

.card-count {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 400;
  color: var(--dim);
  margin-left: 6px;
}

.card-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.card-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--line-soft);
  font-size: 12px;
}

.card-item:last-child {
  border-bottom: none;
}

.ci-q {
  font-family: var(--font-mono);
  color: var(--fg);
  min-width: 52px;
}

.ci-off {
  font-size: 11px;
  border-radius: 5px;
  padding: 1px 6px;
  letter-spacing: 0.08em;
}

.ci-off.ok {
  color: var(--jade);
  border: 1px solid var(--jade-bd);
  background: var(--jade-bg);
}

.ci-off.lost {
  color: var(--btn-ink);
  background: var(--cinnabar);
  border: 1px solid var(--cinnabar);
}

.ci-tag {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--mut);
}

.ci-meta {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--dim);
}

.roster-foot {
  padding: 12px 26px;
  font-size: 11.5px;
  color: var(--dim);
  letter-spacing: 0.04em;
}
</style>
