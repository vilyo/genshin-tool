<script setup lang="ts">
import { computed } from 'vue'
import { UNLINKED_UID } from '@/domain/excelImport'
import { useAppStore } from '@/stores/app'

/**
 * 档案管理(T18,PRD F4):列表展示 uid/创建时间/最近同步/记录数并支持切换。
 * 记录数只对当前档案展示(避免为列表做全量 IO);「0」哨兵档案标注「未关联 UID」。
 */
const store = useAppStore()

/** ISO 串 → 展示文案(本地原串截断;null = 从未) */
function isoText(iso: string | null): string {
  return iso === null ? '—' : iso.slice(0, 16).replace('T', ' ')
}

/** 未关联哨兵档案的展示名(spec 03 §7:'0' = 未关联 UID 的迁入暂存) */
function uidLabel(uid: string): string {
  return uid === UNLINKED_UID ? '未关联 UID' : `UID ${uid}`
}

const currentCount = computed(() => store.records.length)
</script>

<template>
  <div class="set-row col">
    <div class="info">
      <div class="t">档案管理</div>
      <div class="d">一个 UID 一个档案;切换只换展示,数据都保留在本机</div>
    </div>
    <ul class="archive-list">
      <li
        v-for="archive in store.archives"
        :key="archive.uid"
        class="archive-row"
        :class="{ current: archive.uid === store.currentUid }"
      >
        <div class="archive-main">
          <span class="archive-uid">
            {{ uidLabel(archive.uid) }}
            <span
              v-if="archive.uid === store.currentUid"
              class="current-tag"
            >当前</span>
          </span>
          <!-- 记录数只对当前档案展示(已在内存),非当前档案不做全量 IO -->
          <span
            v-if="archive.uid === store.currentUid"
            class="archive-meta"
          >记录 {{ currentCount }} 条</span>
        </div>
        <div class="archive-meta">
          建立 {{ isoText(archive.createdAt) }} · 最近同步 {{ isoText(archive.lastSyncedAt) }}
        </div>
        <button
          v-if="archive.uid !== store.currentUid"
          type="button"
          class="set-btn"
          :disabled="store.busy"
          @click="store.switchArchive(archive.uid)"
        >
          切换
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.archive-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.archive-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--seal-bg);
}

.archive-row.current {
  border-color: var(--accent);
}

.archive-main {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.archive-uid {
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--fg);
}

.current-tag {
  margin-left: 6px;
  padding: 1px 7px;
  border: 1px solid var(--accent);
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--accent);
}

.archive-meta {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--dim);
}

.archive-row .set-btn {
  align-self: flex-end;
  margin-top: 2px;
}
</style>
