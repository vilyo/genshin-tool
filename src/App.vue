<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppTitleBar from '@/components/AppTitleBar.vue'
import ArchiveSwitchConfirm from '@/components/ArchiveSwitchConfirm.vue'
import BoardView from '@/components/board/BoardView.vue'
import ExcelPreviewDialog from '@/components/ExcelPreviewDialog.vue'
import FetchDialog from '@/components/FetchDialog.vue'
import PasteDialog from '@/components/PasteDialog.vue'
import SentinelMergeConfirm from '@/components/SentinelMergeConfirm.vue'
import UidSelectDialog from '@/components/UidSelectDialog.vue'
import { useAppStore } from '@/stores/app'

// 应用壳(F1 装配):标题栏 + 主区域挂载点 + 全局对话框层。
// 有档案时主区域挂主统计画面(T17 V5「璇玑」主版面),空态引导三入口。

const store = useAppStore()
// 粘贴弹窗开关:顶栏下拉与空态入口共用;其余弹窗均为 store 状态驱动
const pasteOpen = ref(false)

onMounted(async () => {
  await store.init()
  // D16 启动自动同步:开关开时静默重走缓存提取→探底→增量拉取,成败都不弹窗
  void store.startupAutoSync()
})
</script>

<template>
  <div class="app">
    <AppTitleBar
      @open-paste="pasteOpen = true"
      @open-excel="store.openExcelImport()"
    />
    <p
      v-if="store.message !== null"
      class="app-banner"
      :class="store.message.kind"
      role="status"
    >
      {{ store.message.text }}
    </p>
    <main class="main-area">
      <!-- 空态:引导三入口 -->
      <section
        v-if="store.records.length === 0"
        class="empty-state"
        aria-label="祈愿档案空态"
      >
        <h2 class="empty-title">尚无祈愿档案</h2>
        <p class="empty-hint">
          在游戏内打开一次「祈愿-历史记录」页,点击「一键获取」自动拉取记录;macOS
          或自动获取失败时,可用「手动导入」粘贴链接,或从 Excel 迁入历史记录。
        </p>
        <div class="empty-actions">
          <button
            type="button"
            class="btn accent"
            :disabled="store.busy"
            @click="store.oneClickFetch()"
          >
            一键获取
          </button>
          <button
            type="button"
            class="btn"
            :disabled="store.busy"
            @click="pasteOpen = true"
          >
            粘贴链接
          </button>
        </div>
      </section>
      <!-- 有档案:主统计画面(V5「璇玑」主版面,T17) -->
      <BoardView v-else />
    </main>

    <!-- 全局对话框层:共用拉取管线 + F1 各待决分支 + Excel 预览 -->
    <FetchDialog />
    <PasteDialog
      :open="pasteOpen"
      @close="pasteOpen = false"
    />
    <UidSelectDialog />
    <ArchiveSwitchConfirm />
    <SentinelMergeConfirm />
    <ExcelPreviewDialog />
  </div>
</template>

<style scoped>
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.app-banner {
  margin: 0;
  padding: 8px 16px;
  font-size: 12.5px;
  letter-spacing: 0.04em;
}

.app-banner.error {
  color: var(--cinnabar);
  background: var(--accent-wash);
}

.main-area {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  /* 主画面自带内边距,壳层零内边距让版面通栏 */
  padding: 0;
}

.empty-state {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  max-width: 480px;
}

.empty-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--fg);
}

.empty-hint {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.9;
  color: var(--mut);
}

.empty-actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}
</style>
