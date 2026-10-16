<script setup lang="ts">
import type { PoolCategory } from '@/domain/pools'
import type { PoolTab } from '@/domain/poolTabs'

/**
 * 池页签栏(V5:菱形徽记 + 官方池名 + 五星计数角标;选中页签下划线)。
 * 页签集与计数由 board store 的 visibleTabs/tabCounts 提供,组件零口径。
 */
defineProps<{
  tabs: PoolTab[]
  counts: Record<PoolCategory, number>
  active: PoolCategory
}>()

defineEmits<{ select: [scope: PoolCategory] }>()
</script>

<template>
  <nav
    class="pool-tabs"
    aria-label="祈愿池页签"
  >
    <button
      v-for="tab in tabs"
      :key="tab.scope"
      type="button"
      class="pool-tab"
      :class="{ on: tab.scope === active, ghost: tab.scope === 'unknown' }"
      :aria-pressed="tab.scope === active"
      @click="$emit('select', tab.scope)"
    >
      <i
        class="tab-dm"
        aria-hidden="true"
      />
      <span class="tab-label">{{ tab.label }}</span>
      <!-- 新手祈愿计数与保底同无展示意义(图版不标),其余页签恒标五星数 -->
      <span
        v-if="tab.scope !== 'novice'"
        class="tab-ct"
      >{{ counts[tab.scope] ?? 0 }}</span>
    </button>
  </nav>
</template>

<style scoped>
.pool-tabs {
  flex: none;
  display: flex;
  align-items: stretch;
  gap: 30px;
  padding: 0 26px;
  border-top: 1px solid var(--line-soft);
  border-bottom: 1px solid var(--line);
  overflow-x: auto;
}

.pool-tab {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 15px 2px;
  border: none;
  background: none;
  font-size: 13.5px;
  letter-spacing: 0.06em;
  color: var(--mut);
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.15s;
}

.pool-tab:hover {
  color: var(--fg);
}

.tab-dm {
  width: 8px;
  height: 8px;
  border: 1.5px solid var(--dim);
  transform: rotate(45deg);
  opacity: 0.7;
}

.tab-ct {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--dim);
  align-self: flex-start;
  margin-top: 8px;
}

.pool-tab.on {
  color: var(--fg);
  font-weight: 600;
  box-shadow: inset 0 -2px 0 var(--accent);
}

.pool-tab.on .tab-dm {
  border-color: var(--accent);
  background: var(--seal-bg);
  opacity: 1;
}

.pool-tab.on .tab-ct {
  color: var(--accent);
}

.pool-tab.ghost {
  opacity: 0.45;
}
</style>
