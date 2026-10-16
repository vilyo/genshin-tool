<script setup lang="ts">
import { useAppStore } from '@/stores/app'

/** D9 多候选选择(spec 02 §4):展示 uid 与探底最新记录时间;uid=null 注明「UID 拉取后确认」 */
const store = useAppStore()

function latestLabel(candidate: { latestTime: string | null }): string {
  // 探底只查 301(spec 02 D6),空列表只能说明角色池无记录,不断言全账号
  return candidate.latestTime === null ? '暂无角色池记录' : `最新记录 ${candidate.latestTime}`
}
</script>

<template>
  <div
    v-if="store.pendingCandidates !== null"
    class="dialog-backdrop"
  >
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-label="选择要拉取的账号"
    >
      <h3 class="dialog-title">检测到多个 UID</h3>
      <p class="dialog-hint">缓存中含有多条有效祈愿链接,请选择要拉取的账号(从新到旧排列):</p>
      <ul class="pick-list">
        <li
          v-for="(candidate, index) in store.pendingCandidates"
          :key="index"
        >
          <button
            type="button"
            class="pick-row"
            @click="store.chooseCandidate(candidate)"
          >
            <span class="row-name">
              {{ candidate.uid === null ? 'UID 拉取后确认' : `UID ${candidate.uid}` }}
            </span>
            <span class="row-meta">{{ latestLabel(candidate) }}</span>
          </button>
        </li>
      </ul>
      <div class="dialog-actions">
        <button
          type="button"
          class="btn"
          @click="store.cancelCandidateSelection()"
        >
          取消
        </button>
      </div>
    </div>
  </div>
</template>
