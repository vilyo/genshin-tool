<script setup lang="ts">
import { useAppStore } from '@/stores/app'

/**
 * 备份导入预览确认(T18,spec 01 §6):展示目标 UID 与将新增/回填/跳过计数,
 * 确认后才落库;导入到非当前档案时提示可在档案管理中切换查看。
 */
const store = useAppStore()
</script>

<template>
  <template v-if="store.pendingBackupImport !== null">
    <div
      class="confirm-backdrop"
      @click="store.cancelBackupImport()"
    />
    <div
      class="dialog confirm-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="导入备份确认"
    >
      <h3 class="dialog-title">导入备份</h3>
      <p class="dialog-hint">
        备份属于档案
        <span class="emphasized">{{ store.pendingBackupImport.targetUid }}</span>
        <template v-if="store.currentUid !== null && !store.pendingBackupImport.isCurrent">
          ,当前档案为
          <span class="emphasized">{{ store.currentUid }}</span>,导入后可在「档案管理」中切换查看。
        </template>
        <template v-else-if="store.currentUid === null">,当前尚无已打开的档案。</template>
        。按去重键合并,只增不减:
      </p>
      <ul class="import-summary">
        <li>将新增 <span class="emphasized">{{ store.pendingBackupImport.result.summary.added }}</span> 条</li>
        <li>回填身份(既有无 id 行) <span class="emphasized">{{ store.pendingBackupImport.result.summary.upgraded }}</span> 条</li>
        <li>重复跳过 <span class="emphasized">{{ store.pendingBackupImport.result.summary.skipped }}</span> 条</li>
      </ul>
      <div class="dialog-actions">
        <button
          type="button"
          class="btn"
          @click="store.cancelBackupImport()"
        >
          取消
        </button>
        <button
          type="button"
          class="btn accent"
          :disabled="store.busy"
          @click="store.confirmBackupImport()"
        >
          确认导入
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

.import-summary {
  list-style: none;
  margin: 0;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--seal-bg);
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--mut);
}
</style>
