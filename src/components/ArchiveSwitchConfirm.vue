<script setup lang="ts">
import { useAppStore } from '@/stores/app'

/** uid 守卫不一致确认(spec 02 §6 / PRD S5):确认后以新 uid 重入 syncAll;拒绝则中止零写入 */
const store = useAppStore()
</script>

<template>
  <div
    v-if="store.pendingMismatch !== null"
    class="dialog-backdrop"
  >
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-label="切换档案确认"
    >
      <h3 class="dialog-title">切换档案</h3>
      <p class="dialog-hint">
        祈愿链接属于 UID
        <span class="emphasized">{{ store.pendingMismatch.resolvedUid }}</span>
        <template v-if="store.currentUid !== null">
          ,当前档案为 UID
          <span class="emphasized">{{ store.currentUid }}</span>。
        </template>
        <template v-else>。</template>
        确认后将把记录导入 UID {{ store.pendingMismatch.resolvedUid }} 的档案;当前档案数据保留在本机,可随时切回。取消则本次不导入任何数据。
      </p>
      <div class="dialog-actions">
        <button
          type="button"
          class="btn"
          @click="store.cancelArchiveSwitch()"
        >
          取消
        </button>
        <button
          type="button"
          class="btn accent"
          @click="store.confirmArchiveSwitch()"
        >
          切换并导入
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
