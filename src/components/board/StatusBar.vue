<script setup lang="ts">
import type { StatusBarView } from '@/domain/highlights'

/**
 * 状态栏(DESIGN §3.4):全本地徽章 + 记录数(档案全部行,含 novice)/覆盖起点 +
 * 最近同步时间(档案元数据)与版本号。数据来自 buildStatusBar 与档案摘要。
 */
const props = defineProps<{
  status: StatusBarView
  lastSyncedAt: string | null
}>()

/** ISO 时间戳 → 「YYYY-MM-DD HH:mm」展示;null = 未同步 */
function formatSynced(iso: string | null): string {
  if (iso === null) return '—'
  return iso.slice(0, 16).replace('T', ' ')
}

const version = __APP_VERSION__
</script>

<template>
  <footer
    class="status-bar"
    aria-label="状态栏"
  >
    <i
      class="dot"
      aria-hidden="true"
    />
    <span class="local-badge">全本地统计</span>
    <span class="meta">
      {{ status.recordCount }} 条记录 · 覆盖 {{ status.since ?? '—' }}
    </span>
    <span class="meta right">
      最近同步 {{ formatSynced(props.lastSyncedAt) }} · v{{ version }} · ARMILLARY
    </span>
  </footer>
</template>

<style scoped>
.status-bar {
  flex: none;
  height: 34px;
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 0 26px;
  border-top: 1px solid var(--line);
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--jade);
  box-shadow: 0 0 6px var(--jade-bd);
}

.local-badge {
  font-size: 11.5px;
  color: var(--mut);
  letter-spacing: 0.06em;
}

.meta {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--dim);
  letter-spacing: 0.04em;
}

.meta.right {
  margin-left: auto;
}
</style>
