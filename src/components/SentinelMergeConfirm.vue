<script setup lang="ts">
import { useAppStore } from '@/stores/app'

/** '0' 哨兵档案并入确认(spec 03 §7):n 从 loadRecords('0') 取;拒绝则 '0' 保留可稍后再并 */
const store = useAppStore()
</script>

<template>
  <div
    v-if="store.pendingSentinelMerge !== null"
    class="dialog-backdrop"
  >
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-label="并入未关联记录"
    >
      <h3 class="dialog-title">并入未关联记录</h3>
      <p class="dialog-hint">
        检测到 UID
        <span class="emphasized">{{ store.currentUid }}</span>
        的档案,本机还有
        {{ store.pendingSentinelMerge.count }} 条未关联 UID 的记录(此前导入)。是否将其并入该档案?
        并入后按同一去重键合并,只增不减;拒绝则未关联档案保留,可稍后再并。
      </p>
      <div class="dialog-actions">
        <button
          type="button"
          class="btn"
          @click="store.cancelSentinelMerge()"
        >
          暂不并入
        </button>
        <button
          type="button"
          class="btn accent"
          @click="store.confirmSentinelMerge()"
        >
          并入 {{ store.pendingSentinelMerge.count }} 条
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.emphasized {
  font-family: var(--font-mono);
  font-weight: 700;
  color: var(--fg);
}
</style>
