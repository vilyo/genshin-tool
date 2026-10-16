<script setup lang="ts">
import { useAppStore } from '@/stores/app'

/**
 * 清空数据二次确认(T18,PRD F4):明确将清空的 UID、记录数与不可恢复性,
 * 建议先导出备份;确认后经 store 走 db_clear_archive(记录+水位+最近同步同清,档案保留)。
 */
const store = useAppStore()
</script>

<template>
  <template v-if="store.pendingClear">
    <div
      class="confirm-backdrop"
      @click="store.cancelClearArchive()"
    />
    <div
      class="dialog confirm-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="清空数据确认"
    >
      <h3 class="dialog-title">清空数据</h3>
      <p class="dialog-hint">
        将清空档案
        <span class="emphasized">{{ store.currentUid ?? '—' }}</span>
        的全部祈愿记录与同步水位,共 {{ store.records.length }} 条。此操作不可恢复,建议先「导出备份」。
        档案本身保留,清空后可重新获取。
      </p>
      <div class="dialog-actions">
        <button
          type="button"
          class="btn"
          @click="store.cancelClearArchive()"
        >
          取消
        </button>
        <button
          type="button"
          class="btn danger"
          :disabled="store.busy"
          @click="store.confirmClearArchive()"
        >
          确认清空
        </button>
      </div>
    </div>
  </template>
</template>

<style scoped>
.confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 120;
  background: var(--backdrop);
}

.confirm-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  z-index: 130;
  transform: translate(-50%, -50%);
}

.emphasized {
  font-family: var(--font-mono);
  font-weight: 700;
  color: var(--fg);
}

.btn.danger {
  border: none;
  background: var(--danger);
  color: #fff;
}

.btn.danger:hover:not(:disabled) {
  color: #fff;
  filter: brightness(1.07);
}
</style>
